# Contributing

Thanks for your interest in contributing to DiscordMute.

DiscordMute is a small monorepo with two main parts:

- `DLL` - the Among Us plugin written in C#
- `DiscordBot` - the companion Discord bot written in TypeScript

## Requirements

### For the Among Us plugin

- [.NET SDK 6](https://dotnet.microsoft.com/en-us/download/dotnet/6.0)
- A local 64-bit Among Us installation (Steam 2026.9.29 or newer, Epic Games or Microsoft Store); the plugin builds against `AmongUs.GameLibs.Steam` 2026.9.29
- The 64-bit (`win-x64`) BepInEx Unity IL2CPP build from the README installed in your Among Us folder if you want to test the plugin in-game

### For the Discord bot

- [Bun](https://bun.sh/)
- A Discord bot application for local testing

## Repository structure

```text
├── DLL/         # C# Among Us plugin
└── DiscordBot/  # TypeScript Discord bot
```

## Local setup

### Build the plugin

From the `DLL` folder:

```bash
dotnet build -c Release
```

If you set the `AmongUs` build property, the project can copy the built DLL directly into your BepInEx plugins folder after a successful build.

On Windows, you can also use the root update script:

1. Copy `update.example.ps1` to `update.ps1`.
2. Open `update.ps1`.
3. Set `$amongUsRoot` to your local Among Us folder.
4. Run the script through Bun from the repository root:

```bash
bun run build
```

This executes `update.ps1`.

### Set up the bot

From the `DiscordBot` folder:

```bash
bun install
```

Create your local config:

```bash
cp config.example.json config.json
```

Then fill in the required Discord bot values.

The bot currently depends on a locally built `galactic.ts` (a `file:` dependency). `galactic.ts` must be checked out next to this repo and built before you run `bun install`. This is temporary until a release is available.

### Build the bot executable

The Discord bot is written in TypeScript, but releases use a compiled Windows executable.

From the `DiscordBot` folder:

```bash
bun run build
```

This command:

1. regenerates the slash-command registry
2. bundles the TypeScript entry point
3. compiles it into `bot.exe`

The generated `bot.exe` is a local build artifact and should not be committed.

### Run checks

From the `DiscordBot` folder:

```bash
bun run test
bun run lint
bun run typecheck
```

Tests run with Vitest under Bun. Discord-facing tests use `probe.ts` instead of hand-written discord.js mocks.

## Development notes

### C# plugin

- Keep compatibility with the supported Among Us / BepInEx environment.
- Prefer graceful fallbacks when optional host mods such as TOHE or EHR are not installed.
- Avoid silent exception handling. If something fails, log a useful warning or error.
- The plugin is stateless and doesn't run its own HTTP server anymore — it connects out to the bot over a WebSocket (`DLL/Core/PluginSocket.cs`). Treat that connection (protocol v2, handshake with version check) as security-sensitive and keep secret validation intact.

### TypeScript bot

- Use Bun for package management and scripts.
- Keep the codebase lint-clean and type-safe.
- Reuse the existing logger and config patterns instead of introducing parallel systems.
- Never commit real bot tokens, secrets, or local config files.

## Before opening a pull request

Please make sure that:

- the plugin builds successfully
- the bot tests pass
- the bot passes linting
- the bot passes type checking
- no secrets or local config files are included
- your change is focused and easy to review

Useful commands:

```bash
# DLL
dotnet build -c Release

# DiscordBot
bun run test
bun run lint
bun run typecheck
```

## Reporting issues

When opening an issue, please include:

- what you expected to happen
- what actually happened
- your Among Us / BepInEx setup
- whether you use TOHE or EHR
- relevant logs if available
