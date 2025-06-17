# Alga CLI Configuration

The Alga CLI now supports a configuration file to store user preferences and defaults, eliminating the need to repeatedly specify common options.

## Configuration File Location

The configuration file is stored at:
- Linux/macOS: `~/.config/alga-cli/config.toml`
- Or respects `$XDG_CONFIG_HOME` if set: `$XDG_CONFIG_HOME/alga-cli/config.toml`

## Quick Start

Initialize your configuration:
```bash
nu cli/main.nu config init
```

This will prompt you for:
- Your git author name
- Your git author email
- Default edition preference (ce/ee)

## Configuration Commands

### Initialize Configuration
```bash
nu cli/main.nu config init [--force]
```
Creates a new configuration file with prompts. Use `--force` to overwrite existing config.

### Show Configuration
```bash
nu cli/main.nu config show
```
Displays the current configuration and file location.

### Get Configuration Value
```bash
nu cli/main.nu config get <key>
```
Examples:
```bash
nu cli/main.nu config get dev_env.author.name
nu cli/main.nu config get dev_env.author.email
nu cli/main.nu config get dev_env.default_edition
```

### Set Configuration Value
```bash
nu cli/main.nu config set <key> <value>
```
Examples:
```bash
nu cli/main.nu config set dev_env.author.name "John Doe"
nu cli/main.nu config set dev_env.author.email "john@example.com"
nu cli/main.nu config set dev_env.default_edition "ee"
```

## Configuration Structure

The configuration file uses TOML format:

```toml
version = "1.0"

[dev_env]
default_edition = "ee"

[dev_env.author]
name = "John Doe"
email = "john@example.com"
```

## Using Configuration with dev-env-create

When creating a development environment, the CLI will use your configured author information by default:

```bash
# Uses author info from config
nu cli/main.nu dev-env-create my-feature

# Override config with command-line options
nu cli/main.nu dev-env-create my-feature --author-name "Jane Doe" --author-email "jane@example.com"
```

If author information is loaded from config, you'll see a message:
```
Using git author from config: John Doe <john@example.com>
```

## Priority Order

The CLI uses the following priority for git author information:
1. Command-line parameters (`--author-name`, `--author-email`)
2. Configuration file values
3. Default values ("Dev Environment" <dev@alga.local>)

## Future Configuration Options

The configuration system is designed to be extensible. Future options may include:
- Default Kubernetes namespace patterns
- Preferred external port ranges
- Custom repository URLs
- Build and deployment preferences
- AI automation settings