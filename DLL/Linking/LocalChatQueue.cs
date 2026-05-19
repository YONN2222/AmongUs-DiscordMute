using System.Collections.Concurrent;

namespace DiscordMute.Linking;

internal static class LocalChatQueue
{
    internal static readonly ConcurrentQueue<string> Pending = new();
}
