using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

namespace ConnectSupportService;

internal static class SessionLauncher
{
    private const uint TokenAssignPrimary = 0x0001;
    private const uint TokenDuplicate = 0x0002;
    private const uint TokenQuery = 0x0008;
    private const uint TokenAdjustDefault = 0x0080;
    private const uint TokenAdjustSessionId = 0x0100;
    private const uint CreateUnicodeEnvironment = 0x00000400;
    private const int SecurityImpersonation = 2;
    private const int TokenPrimary = 1;

    public static uint? GetActiveInteractiveSessionId()
    {
        IntPtr sessionBuffer = IntPtr.Zero;
        var activeSessions = new List<uint>();

        if (!Native.WTSEnumerateSessionsW(IntPtr.Zero, 0, 1, out sessionBuffer, out var count))
        {
            var error = Marshal.GetLastWin32Error();
            ServiceFileLog.WriteWin32Failure("WTSEnumerateSessionsW", error, null);
            return null;
        }

        try
        {
            var current = sessionBuffer;
            var size = Marshal.SizeOf<WtsSessionInfo>();
            for (var index = 0; index < count; index++)
            {
                var session = Marshal.PtrToStructure<WtsSessionInfo>(current);
                if (session.SessionId != 0 && session.State == WtsConnectState.Active)
                {
                    activeSessions.Add(session.SessionId);
                }

                current = IntPtr.Add(current, size);
            }
        }
        finally
        {
            if (sessionBuffer != IntPtr.Zero)
            {
                Native.WTSFreeMemory(sessionBuffer);
            }
        }

        if (activeSessions.Count == 0)
        {
            return null;
        }

        // Prefer the active physical-console session when it is among the WTSActive
        // sessions; otherwise use an active RDP session rather than assuming console.
        var consoleSessionId = Native.WTSGetActiveConsoleSessionId();
        var selectedSession = activeSessions.Contains(consoleSessionId)
            ? consoleSessionId
            : activeSessions[0];

        return selectedSession;
    }

    public static Process Launch(string executablePath, uint sessionId)
    {
        var servicePath = Environment.ProcessPath ?? "<unknown>";
        var fullAgentPath = Path.GetFullPath(executablePath);
        var agentExists = File.Exists(fullAgentPath);

        ServiceFileLog.Write($"[Session] Active session: {sessionId}");
        ServiceFileLog.Write($"[Agent] AppContext.BaseDirectory: {AppContext.BaseDirectory}");
        ServiceFileLog.Write($"[Agent] Service executable path: {servicePath}");
        ServiceFileLog.Write($"[Agent] Path: {fullAgentPath}");
        ServiceFileLog.Write($"[Agent] Exists: {agentExists}");

        if (!agentExists)
        {
            var exception = new FileNotFoundException(
                $"Connect Support agent executable not found at '{fullAgentPath}'.",
                fullAgentPath);
            ServiceFileLog.Write($"[Agent] Launch failed: {exception.Message}");
            throw exception;
        }

        IntPtr userToken = IntPtr.Zero;
        IntPtr primaryToken = IntPtr.Zero;
        IntPtr environment = IntPtr.Zero;
        ProcessInformation processInfo = default;

        try
        {
            ServiceFileLog.Write($"[Token] Calling WTSQueryUserToken for session {sessionId}.");
            if (!Native.WTSQueryUserToken(sessionId, out userToken))
            {
                var error = Marshal.GetLastWin32Error();
                ServiceFileLog.WriteWin32Failure("WTSQueryUserToken", error, sessionId);
                throw CreateWin32Exception("WTSQueryUserToken", error, sessionId);
            }
            ServiceFileLog.Write("[Token] WTSQueryUserToken succeeded");

            var desiredAccess = TokenAssignPrimary | TokenDuplicate | TokenQuery |
                                TokenAdjustDefault | TokenAdjustSessionId;
            ServiceFileLog.Write("[Token] Calling DuplicateTokenEx.");
            if (!Native.DuplicateTokenEx(
                    userToken,
                    desiredAccess,
                    IntPtr.Zero,
                    SecurityImpersonation,
                    TokenPrimary,
                    out primaryToken))
            {
                var error = Marshal.GetLastWin32Error();
                ServiceFileLog.WriteWin32Failure("DuplicateTokenEx", error, sessionId);
                throw CreateWin32Exception("DuplicateTokenEx", error, sessionId);
            }
            ServiceFileLog.Write("[Token] DuplicateTokenEx succeeded");

            ServiceFileLog.Write("[Environment] Calling CreateEnvironmentBlock.");
            if (!Native.CreateEnvironmentBlock(out environment, primaryToken, false))
            {
                var error = Marshal.GetLastWin32Error();
                ServiceFileLog.WriteWin32Failure("CreateEnvironmentBlock", error, sessionId);
                throw CreateWin32Exception("CreateEnvironmentBlock", error, sessionId);
            }
            ServiceFileLog.Write("[Environment] CreateEnvironmentBlock succeeded");

            var startupInfo = new StartupInfo
            {
                Size = Marshal.SizeOf<StartupInfo>(),
                Desktop = @"winsta0\default",
            };
            // lpApplicationName is the exact executable path. The command line has
            // the quoted argv[0] plus only the existing background-start argument.
            var commandLine = new StringBuilder($"\"{fullAgentPath}\" --hidden");
            var workingDirectory = Path.GetDirectoryName(fullAgentPath)
                ?? throw new InvalidOperationException("Could not resolve the agent working directory.");

            ServiceFileLog.Write("[Agent] CreateProcessAsUserW parameters:");
            ServiceFileLog.Write($"[Agent] lpApplicationName: {fullAgentPath}");
            ServiceFileLog.Write($"[Agent] lpCommandLine: {commandLine}");
            ServiceFileLog.Write($"[Agent] Desktop: {startupInfo.Desktop}");
            ServiceFileLog.Write($"[Agent] Working directory: {workingDirectory}");
            ServiceFileLog.Write($"[Agent] Session ID: {sessionId}");
            ServiceFileLog.Write($"[Agent] Creation flags: 0x{CreateUnicodeEnvironment:X8}");

            var created = Native.CreateProcessAsUserW(
                primaryToken,
                fullAgentPath,
                commandLine,
                IntPtr.Zero,
                IntPtr.Zero,
                false,
                CreateUnicodeEnvironment,
                environment,
                workingDirectory,
                ref startupInfo,
                out processInfo);

            if (!created)
            {
                // Capture the thread's last-error value immediately after the API returns.
                var error = Marshal.GetLastWin32Error();
                ServiceFileLog.WriteWin32Failure("CreateProcessAsUserW", error, sessionId);
                throw CreateWin32Exception("CreateProcessAsUserW", error, sessionId);
            }

            ServiceFileLog.Write("[Agent] CreateProcessAsUserW succeeded");
            ServiceFileLog.Write($"[Agent] PID: {processInfo.ProcessId}");

            // Acquire a managed Process handle before closing the native process handle
            // in finally. This keeps the created process available to the supervisor.
            return Process.GetProcessById(checked((int)processInfo.ProcessId));
        }
        finally
        {
            if (environment != IntPtr.Zero && !Native.DestroyEnvironmentBlock(environment))
            {
                var error = Marshal.GetLastWin32Error();
                ServiceFileLog.WriteWin32Failure("DestroyEnvironmentBlock", error, sessionId);
            }

            if (processInfo.Thread != IntPtr.Zero && !Native.CloseHandle(processInfo.Thread))
            {
                var error = Marshal.GetLastWin32Error();
                ServiceFileLog.WriteWin32Failure("CloseHandle(thread)", error, sessionId);
            }

            if (processInfo.Process != IntPtr.Zero && !Native.CloseHandle(processInfo.Process))
            {
                var error = Marshal.GetLastWin32Error();
                ServiceFileLog.WriteWin32Failure("CloseHandle(process)", error, sessionId);
            }

            if (primaryToken != IntPtr.Zero && !Native.CloseHandle(primaryToken))
            {
                var error = Marshal.GetLastWin32Error();
                ServiceFileLog.WriteWin32Failure("CloseHandle(primary token)", error, sessionId);
            }

            if (userToken != IntPtr.Zero && !Native.CloseHandle(userToken))
            {
                var error = Marshal.GetLastWin32Error();
                ServiceFileLog.WriteWin32Failure("CloseHandle(WTS token)", error, sessionId);
            }
        }
    }

    private static Win32Exception CreateWin32Exception(string apiName, int error, uint sessionId) =>
        new(error, $"{apiName} failed for session {sessionId}: {new Win32Exception(error).Message}");

    private enum WtsConnectState
    {
        Active,
        Connected,
        ConnectQuery,
        Shadow,
        Disconnected,
        Idle,
        Listen,
        Reset,
        Down,
        Init,
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct WtsSessionInfo
    {
        public uint SessionId;
        public IntPtr WinStationName;
        public WtsConnectState State;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct StartupInfo
    {
        public int Size;
        public string? Reserved;
        public string? Desktop;
        public string? Title;
        public uint X;
        public uint Y;
        public uint XSize;
        public uint YSize;
        public uint XCountChars;
        public uint YCountChars;
        public uint FillAttribute;
        public uint Flags;
        public ushort ShowWindow;
        public ushort Reserved2;
        public IntPtr Reserved2Pointer;
        public IntPtr StandardInput;
        public IntPtr StandardOutput;
        public IntPtr StandardError;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct ProcessInformation
    {
        public IntPtr Process;
        public IntPtr Thread;
        public uint ProcessId;
        public uint ThreadId;
    }

    private static class Native
    {
        [DllImport("kernel32.dll")]
        internal static extern uint WTSGetActiveConsoleSessionId();

        [DllImport("wtsapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool WTSEnumerateSessionsW(
            IntPtr server,
            int reserved,
            int version,
            out IntPtr sessionInfo,
            out int count);

        [DllImport("wtsapi32.dll")]
        internal static extern void WTSFreeMemory(IntPtr memory);

        [DllImport("wtsapi32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool WTSQueryUserToken(uint sessionId, out IntPtr token);

        [DllImport("advapi32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool DuplicateTokenEx(
            IntPtr existingToken,
            uint desiredAccess,
            IntPtr tokenAttributes,
            int impersonationLevel,
            int tokenType,
            out IntPtr newToken);

        [DllImport("userenv.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool CreateEnvironmentBlock(out IntPtr environment, IntPtr token, bool inherit);

        [DllImport("userenv.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool DestroyEnvironmentBlock(IntPtr environment);

        [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool CreateProcessAsUserW(
            IntPtr token,
            string applicationName,
            StringBuilder commandLine,
            IntPtr processAttributes,
            IntPtr threadAttributes,
            [MarshalAs(UnmanagedType.Bool)] bool inheritHandles,
            uint creationFlags,
            IntPtr environment,
            string? currentDirectory,
            ref StartupInfo startupInfo,
            out ProcessInformation processInformation);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool CloseHandle(IntPtr handle);
    }
}
