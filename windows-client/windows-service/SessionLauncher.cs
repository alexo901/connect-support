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
        var consoleSessionId = Native.WTSGetActiveConsoleSessionId();
        var activeSessions = new List<uint>();
        IntPtr sessionBuffer = IntPtr.Zero;

        try
        {
            if (Native.WTSEnumerateSessionsW(IntPtr.Zero, 0, 1, out sessionBuffer, out var count))
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
        }
        finally
        {
            if (sessionBuffer != IntPtr.Zero)
            {
                Native.WTSFreeMemory(sessionBuffer);
            }
        }

        if (consoleSessionId != uint.MaxValue && activeSessions.Contains(consoleSessionId))
        {
            return consoleSessionId;
        }

        if (activeSessions.Count > 0)
        {
            return activeSessions[0];
        }

        return null;
    }

    public static Process Launch(string executablePath, uint sessionId)
    {
        if (!File.Exists(executablePath))
        {
            throw new FileNotFoundException("The Connect Support interactive agent was not found.", executablePath);
        }

        IntPtr userToken = IntPtr.Zero;
        IntPtr primaryToken = IntPtr.Zero;
        IntPtr environment = IntPtr.Zero;
        ProcessInformation processInfo = default;

        try
        {
            if (!Native.WTSQueryUserToken(sessionId, out userToken))
            {
                throw LastWin32Error("WTSQueryUserToken failed");
            }

            var desiredAccess = TokenAssignPrimary | TokenDuplicate | TokenQuery |
                                TokenAdjustDefault | TokenAdjustSessionId;
            if (!Native.DuplicateTokenEx(
                    userToken,
                    desiredAccess,
                    IntPtr.Zero,
                    SecurityImpersonation,
                    TokenPrimary,
                    out primaryToken))
            {
                throw LastWin32Error("DuplicateTokenEx failed");
            }

            if (!Native.CreateEnvironmentBlock(out environment, primaryToken, false))
            {
                throw LastWin32Error("CreateEnvironmentBlock failed");
            }

            var startupInfo = new StartupInfo
            {
                Size = Marshal.SizeOf<StartupInfo>(),
                Desktop = @"winsta0\default",
            };
            var commandLine = new StringBuilder($"\"{executablePath}\" --hidden");

            if (!Native.CreateProcessAsUserW(
                    primaryToken,
                    executablePath,
                    commandLine,
                    IntPtr.Zero,
                    IntPtr.Zero,
                    false,
                    CreateUnicodeEnvironment,
                    environment,
                    Path.GetDirectoryName(executablePath),
                    ref startupInfo,
                    out processInfo))
            {
                throw LastWin32Error("CreateProcessAsUserW failed");
            }

            return Process.GetProcessById(checked((int)processInfo.ProcessId));
        }
        finally
        {
            if (environment != IntPtr.Zero)
            {
                Native.DestroyEnvironmentBlock(environment);
            }

            if (processInfo.Thread != IntPtr.Zero)
            {
                Native.CloseHandle(processInfo.Thread);
            }

            if (processInfo.Process != IntPtr.Zero)
            {
                Native.CloseHandle(processInfo.Process);
            }

            if (primaryToken != IntPtr.Zero)
            {
                Native.CloseHandle(primaryToken);
            }

            if (userToken != IntPtr.Zero)
            {
                Native.CloseHandle(userToken);
            }
        }
    }

    private static Win32Exception LastWin32Error(string operation) =>
        new(Marshal.GetLastWin32Error(), operation);

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

        [DllImport("userenv.dll")]
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
