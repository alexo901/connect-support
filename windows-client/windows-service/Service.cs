using System.ComponentModel;
using System.Diagnostics;

namespace ConnectSupportService;

internal sealed class AgentSupervisorService(ILogger<AgentSupervisorService> logger) : BackgroundService
{
    private static readonly TimeSpan PollInterval = TimeSpan.FromSeconds(4);
    private static readonly TimeSpan GracefulStopTimeout = TimeSpan.FromSeconds(5);
    private readonly string _agentPath = Path.GetFullPath(
        Path.Combine(AppContext.BaseDirectory, "..", "..", "Connect Support.exe"));

    private Process? _existingAgentProcess;
    private LaunchedAgentProcess? _launchedAgentProcess;
    private int? _agentProcessId;
    private uint? _sessionId;

    public override Task StartAsync(CancellationToken cancellationToken)
    {
        ServiceFileLog.Write("[Service] ConnectSupportAgent starting.");
        ServiceFileLog.Write($"[Agent] AppContext.BaseDirectory: {AppContext.BaseDirectory}");
        ServiceFileLog.Write($"[Agent] Service executable path: {Environment.ProcessPath ?? "<unknown>"}");
        ServiceFileLog.Write($"[Agent] Resolved agent path: {_agentPath}");
        ServiceFileLog.Write($"[Agent] File.Exists(agentPath): {File.Exists(_agentPath)}");
        return base.StartAsync(cancellationToken);
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await Task.Yield();
        logger.LogInformation("Connect Support service is supervising the interactive agent.");

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                var activeSession = SessionLauncher.GetActiveInteractiveSessionId();
                if (activeSession != _sessionId)
                {
                    ServiceFileLog.Write(activeSession.HasValue
                        ? $"[Session] Active session: {activeSession.Value}"
                        : "[Session] No active interactive session; waiting for login.");
                    logger.LogInformation("Interactive session changed from {PreviousSession} to {ActiveSession}.",
                        _sessionId, activeSession);
                    await StopAgentAsync();
                    _sessionId = activeSession;
                }

                if (activeSession.HasValue)
                {
                    await EnsureAgentRunningAsync(activeSession.Value, stoppingToken);
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception exception)
            {
                logger.LogError(exception, "Agent supervision pass failed; retrying.");
                ServiceFileLog.Write($"[Service] Agent supervision failed; will retry: {exception}");
            }

            try
            {
                await Task.Delay(PollInterval, stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
        }

        await StopAgentAsync();
        logger.LogInformation("Connect Support service stopped.");
        ServiceFileLog.Write("[Service] ConnectSupportAgent stopped.");
    }

    private async Task EnsureAgentRunningAsync(uint sessionId, CancellationToken stoppingToken)
    {
        if (_launchedAgentProcess is not null)
        {
            try
            {
                if (!_launchedAgentProcess.HasExited)
                {
                    return;
                }

                logger.LogWarning("Interactive agent process {ProcessId} exited; restarting.", _agentProcessId);
                ServiceFileLog.Write($"[Agent] PID {_agentProcessId} exited; restarting it.");
            }
            catch (Exception exception) when (exception is ObjectDisposedException or System.ComponentModel.Win32Exception)
            {
                logger.LogWarning(exception, "Could not query tracked agent PID {ProcessId}; will check by PID again.",
                    _agentProcessId);
                ServiceFileLog.Write($"[Agent] Could not query PID {_agentProcessId}; treating its state as uncertain: {exception}");
                return;
            }

            _launchedAgentProcess.Dispose();
            _launchedAgentProcess = null;
            _agentProcessId = null;
        }

        if (_existingAgentProcess is not null)
        {
            try
            {
                if (!_existingAgentProcess.HasExited)
                {
                    return;
                }
                _existingAgentProcess.Dispose();
                _existingAgentProcess = null;
                _agentProcessId = null;
            }
            catch (Exception exception) when (exception is InvalidOperationException or
                                               ObjectDisposedException or
                                               System.ComponentModel.Win32Exception)
            {
                logger.LogWarning(exception, "Could not observe existing agent PID {ProcessId}; retrying observation.",
                    _agentProcessId);
                ServiceFileLog.Write($"[Agent] Could not observe existing PID {_agentProcessId}; will retry: {exception}");
                return;
            }
        }

        _existingAgentProcess = FindExistingAgent(sessionId);
        if (_existingAgentProcess is not null)
        {
            _agentProcessId = _existingAgentProcess.Id;
            logger.LogInformation("Monitoring existing agent process {ProcessId} in session {SessionId}.",
                _agentProcessId, sessionId);
            return;
        }

        stoppingToken.ThrowIfCancellationRequested();
        _launchedAgentProcess = SessionLauncher.Launch(_agentPath, sessionId);
        _agentProcessId = _launchedAgentProcess.ProcessId;
        logger.LogInformation("Started Connect Support.exe in session {SessionId} (PID {ProcessId}).",
            sessionId, _agentProcessId);
        ServiceFileLog.Write($"[Agent] Supervisor is tracking PID {_agentProcessId} in session {sessionId}.");
    }

    private Process? FindExistingAgent(uint sessionId)
    {
        var processName = Path.GetFileNameWithoutExtension(_agentPath);
        foreach (var candidate in Process.GetProcessesByName(processName))
        {
            try
            {
                if ((uint)candidate.SessionId == sessionId &&
                    string.Equals(candidate.MainModule?.FileName, _agentPath, StringComparison.OrdinalIgnoreCase))
                {
                    return candidate;
                }
            }
            catch (Exception exception) when (exception is InvalidOperationException or
                                               System.ComponentModel.Win32Exception or
                                               NotSupportedException)
            {
                logger.LogDebug(exception, "Could not inspect a same-name process while looking for an existing agent.");
            }

            candidate.Dispose();
        }

        return null;
    }

    private async Task StopAgentAsync()
    {
        var existingProcess = _existingAgentProcess;
        var launchedProcess = _launchedAgentProcess;
        var processId = _agentProcessId;
        var sessionId = _sessionId;
        _existingAgentProcess = null;
        _launchedAgentProcess = null;
        _agentProcessId = null;
        if (existingProcess is null && launchedProcess is null)
        {
            return;
        }

        try
        {
            if (launchedProcess is not null)
            {
                if (!launchedProcess.HasExited)
                {
                    ServiceFileLog.Write($"[Agent] Stopping tracked native PID {processId} in session {sessionId}.");
                    TryCloseLaunchedAgentWindow(processId, sessionId);
                    var stopped = await WaitForNativeAgentExitAsync(launchedProcess, GracefulStopTimeout);
                    if (!stopped)
                    {
                        // TerminateProcess uses the retained CreateProcessAsUserW process
                        // handle, never a PID lookup that could target a reused PID.
                        launchedProcess.Terminate(1);
                        await WaitForNativeAgentExitAsync(launchedProcess, Timeout.InfiniteTimeSpan);
                    }
                }
            }

            if (existingProcess is not null)
            {
                if (!existingProcess.HasExited)
                {
                    ServiceFileLog.Write($"[Agent] Stopping previously-running agent PID {processId}.");
                    existingProcess.CloseMainWindow();
                    using var timeout = new CancellationTokenSource(GracefulStopTimeout);
                    try
                    {
                        await existingProcess.WaitForExitAsync(timeout.Token);
                    }
                    catch (OperationCanceledException)
                    {
                        if (!existingProcess.HasExited)
                        {
                            // This Process object owns a handle to the verified process
                            // instance, so Kill cannot affect a later PID reuse.
                            existingProcess.Kill(entireProcessTree: true);
                            await existingProcess.WaitForExitAsync();
                        }
                    }
                }
            }
            ServiceFileLog.Write($"[Agent] Tracked PID {processId} has stopped.");
        }
        catch (Exception exception) when (exception is InvalidOperationException or
                                           System.ComponentModel.Win32Exception or
                                           NotSupportedException)
        {
            logger.LogWarning(exception, "Could not stop the interactive agent cleanly.");
        }
        finally
        {
            existingProcess?.Dispose();
            launchedProcess?.Dispose();
        }
    }

    private void TryCloseLaunchedAgentWindow(int? processId, uint? sessionId)
    {
        if (!processId.HasValue) return;

        try
        {
            using var observer = Process.GetProcessById(processId.Value);
            if ((uint)observer.SessionId != sessionId ||
                !string.Equals(observer.MainModule?.FileName, _agentPath, StringComparison.OrdinalIgnoreCase))
            {
                ServiceFileLog.Write($"[Agent] Skipping graceful close for PID {processId}; image/session no longer matches Connect Support.");
                return;
            }

            observer.CloseMainWindow();
        }
        catch (Exception exception) when (exception is ArgumentException or InvalidOperationException or
                                           System.ComponentModel.Win32Exception or NotSupportedException)
        {
            ServiceFileLog.Write($"[Agent] Graceful close lookup for PID {processId} failed; retained process handle remains authoritative: {exception}");
        }
    }

    private static async Task<bool> WaitForNativeAgentExitAsync(
        LaunchedAgentProcess process,
        TimeSpan timeout)
    {
        var timer = Stopwatch.StartNew();
        while (!process.HasExited)
        {
            if (timeout != Timeout.InfiniteTimeSpan && timer.Elapsed >= timeout)
            {
                return false;
            }

            await Task.Delay(TimeSpan.FromMilliseconds(100));
        }

        return true;
    }
}

internal static class ServiceFileLog
{
    private static readonly object Sync = new();
    private static readonly string LogDirectory = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
        "Connect Support",
        "logs");
    private static readonly string LogPath = Path.Combine(LogDirectory, "service.log");

    public static void Write(string message)
    {
        var line = $"[{DateTimeOffset.Now:yyyy-MM-dd HH:mm:ss.fff zzz}] {message}{Environment.NewLine}";
        try
        {
            lock (Sync)
            {
                Directory.CreateDirectory(LogDirectory);
                File.AppendAllText(LogPath, line);
            }
        }
        catch (Exception exception)
        {
            Trace.WriteLine($"Unable to write Connect Support service log '{LogPath}': {exception}; {line}");
        }
    }

    public static void WriteWin32Failure(string apiName, int error, uint? sessionId)
    {
        var message = new Win32Exception(error).Message;
        var session = sessionId.HasValue ? $" for session {sessionId.Value}" : string.Empty;
        Write($"[{apiName}] failed{session}; GetLastWin32Error()={error}; Windows error: {message}");
    }
}
