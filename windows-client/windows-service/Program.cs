using ConnectSupportService;
using Microsoft.Extensions.Hosting;

var builder = Host.CreateApplicationBuilder(args);
builder.Services.AddWindowsService(options =>
{
    options.ServiceName = "ConnectSupportAgent";
});
builder.Services.AddHostedService<AgentSupervisorService>();

await builder.Build().RunAsync();
