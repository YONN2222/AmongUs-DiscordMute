using System;
using System.IO;
using System.Net;
using System.Text.Json;
using System.Threading;
using BepInEx;

namespace DiscordMute.Core;

internal static class HttpServer
{
    private static HttpListener _listener;

    internal static void Start()
    {
        try
        {
            _listener = new HttpListener();
            _listener.Prefixes.Add($"http://{DiscordMutePlugin.Cfg.PluginIp}:{DiscordMutePlugin.Cfg.PluginPort}/");
            _listener.Start();
            new Thread(ListenLoop) { IsBackground = true }.Start();
        }
        catch (Exception ex)
        {
            DiscordMutePlugin.PluginLog.LogError($"Failed to start plugin HTTP server: {ex.Message}");
        }
    }

    private static void ListenLoop()
    {
        while (_listener?.IsListening == true)
        {
            try
            {
                var ctx = _listener.GetContext();
                ThreadPool.QueueUserWorkItem(_ => HandleRequest(ctx));
            }
            catch (Exception ex)
            {
                DiscordMutePlugin.PluginLog.LogWarning($"Plugin HTTP listener stopped receiving requests: {ex.Message}");
            }
        }
    }

    private static void HandleRequest(HttpListenerContext ctx)
    {
        try
        {
            var method = ctx.Request.HttpMethod;
            var path = ctx.Request.Url?.AbsolutePath;
            string requestBody = null;

            if (method == "POST")
            {
                using var reader = new StreamReader(ctx.Request.InputStream, ctx.Request.ContentEncoding);
                requestBody = reader.ReadToEnd();
            }

            ctx.Response.StatusCode = 200;
            ctx.Response.ContentType = "application/json";

            if (path == "/ping")
            {
                var body = "{\"status\":\"ok\"}"u8.ToArray();
                ctx.Response.OutputStream.Write(body, 0, body.Length);
            }
            else if (path == "/link-pending")
            {
                if (!HasValidSecret(requestBody))
                {
                    WriteJson(ctx, 401, "{\"status\":\"unauthorized\"}");
                    return;
                }

                var doc = JsonDocument.Parse(requestBody ?? "{}");
                var root = doc.RootElement;
                if (root.TryGetProperty("phrase", out var p) && root.TryGetProperty("discordId", out var id))
                    DiscordMutePlugin.PendingLinks[p.GetString()] = id.GetString();
                WriteJson(ctx, 200, "{\"status\":\"ok\"}");
            }
            else if (path == "/force-link")
            {
                if (!HasValidSecret(requestBody))
                {
                    WriteJson(ctx, 401, "{\"status\":\"unauthorized\"}");
                    return;
                }

                var doc = JsonDocument.Parse(requestBody ?? "{}");
                var root = doc.RootElement;
                if (root.TryGetProperty("accountName", out var n) && root.TryGetProperty("discordId", out var id))
                    DiscordMutePlugin.SavePluginLink(n.GetString(), id.GetString());
                WriteJson(ctx, 200, "{\"status\":\"ok\"}");
            }
        }
        catch (Exception ex)
        {
            DiscordMutePlugin.PluginLog.LogError($"Plugin HTTP request failed: {ex.Message}");
            WriteJson(ctx, 500, "{\"status\":\"error\"}");
        }
        finally { ctx.Response.Close(); }
    }

    private static bool HasValidSecret(string requestBody)
    {
        try
        {
            var doc = JsonDocument.Parse(requestBody ?? "{}");
            var root = doc.RootElement;
            return root.TryGetProperty("secret", out var secret) && secret.GetString() == DiscordMutePlugin.Cfg.Secret;
        }
        catch (Exception ex)
        {
            DiscordMutePlugin.PluginLog.LogWarning($"Failed to validate request secret: {ex.Message}");
            return false;
        }
    }

    private static void WriteJson(HttpListenerContext ctx, int statusCode, string body)
    {
        var bytes = System.Text.Encoding.UTF8.GetBytes(body);
        ctx.Response.StatusCode = statusCode;
        ctx.Response.ContentType = "application/json";
        ctx.Response.OutputStream.Write(bytes, 0, bytes.Length);
    }
}
