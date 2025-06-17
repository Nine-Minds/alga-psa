#!/usr/bin/env nu

# Alga CLI Configuration Module
# Manages user-specific configuration for the Alga development CLI

use "utils.nu" *

# Get the configuration file path
export def get-config-path [] {
    let config_dir = if ($env.XDG_CONFIG_HOME? | is-empty) {
        $nu.home-path | path join ".config"
    } else {
        $env.XDG_CONFIG_HOME
    }
    
    let alga_config_dir = $config_dir | path join "alga-cli"
    let config_file = $alga_config_dir | path join "config.toml"
    
    { dir: $alga_config_dir, file: $config_file }
}

# Load configuration from file
export def load-config [] {
    let paths = get-config-path
    
    # Return default config if file doesn't exist
    if not ($paths.file | path exists) {
        return {
            version: "1.0"
            dev_env: {
                author: {
                    name: ""
                    email: ""
                }
                default_edition: "ee"
            }
        }
    }
    
    # Load and parse TOML config file
    try {
        open $paths.file | from toml
    } catch {
        print $"($env.ALGA_COLOR_YELLOW)Warning: Could not parse config file at ($paths.file)($env.ALGA_COLOR_RESET)"
        print $"($env.ALGA_COLOR_YELLOW)Using default configuration($env.ALGA_COLOR_RESET)"
        # Return default config on error
        {
            version: "1.0"
            dev_env: {
                author: {
                    name: ""
                    email: ""
                }
                default_edition: "ee"
            }
        }
    }
}

# Save configuration to file
export def save-config [config: record] {
    let paths = get-config-path
    
    # Create config directory if it doesn't exist
    if not ($paths.dir | path exists) {
        mkdir $paths.dir
    }
    
    # Save config as TOML
    $config | to toml | save -f $paths.file
    
    print $"($env.ALGA_COLOR_GREEN)Configuration saved to ($paths.file)($env.ALGA_COLOR_RESET)"
}

# Get a specific configuration value
export def get-config-value [key: string] {
    let config = load-config
    
    # Navigate through nested keys (e.g., "dev_env.author.name")
    let keys = $key | split row "."
    
    mut value = $config
    for k in $keys {
        if ($value | describe) == "record" and ($k in $value) {
            $value = $value | get $k
        } else {
            return null
        }
    }
    
    $value
}

# Set a specific configuration value
export def set-config-value [key: string, value: any] {
    mut config = load-config
    
    # Navigate through nested keys
    let keys = $key | split row "."
    
    if ($keys | length) == 1 {
        # Simple key
        $config = $config | upsert $key $value
    } else if ($keys | length) == 2 {
        # One level nested
        let parent = $keys.0
        let child = $keys.1
        
        # Ensure parent exists as a record
        if not ($parent in $config) {
            $config = $config | upsert $parent {}
        }
        
        let parent_value = $config | get $parent | upsert $child $value
        $config = $config | upsert $parent $parent_value
    } else if ($keys | length) == 3 {
        # Two levels nested (e.g., dev_env.author.name)
        let level1 = $keys.0
        let level2 = $keys.1
        let level3 = $keys.2
        
        # Ensure nested structure exists
        if not ($level1 in $config) {
            $config = $config | upsert $level1 {}
        }
        
        let level1_value = $config | get $level1
        if not ($level2 in $level1_value) {
            let updated_level1 = $level1_value | upsert $level2 {}
            $config = $config | upsert $level1 $updated_level1
        }
        
        let level2_value = $config | get $level1 | get $level2 | upsert $level3 $value
        let updated_level1 = $config | get $level1 | upsert $level2 $level2_value
        $config = $config | upsert $level1 $updated_level1
    }
    
    save-config $config
}

# Initialize configuration with prompts
export def init-config [--force] {
    let paths = get-config-path
    
    if ($paths.file | path exists) and not $force {
        print $"($env.ALGA_COLOR_YELLOW)Configuration file already exists at ($paths.file)($env.ALGA_COLOR_RESET)"
        let overwrite = (input "Do you want to overwrite it? (y/N): ")
        if $overwrite != "y" {
            print "Configuration initialization cancelled."
            return
        }
    }
    
    print $"($env.ALGA_COLOR_CYAN)Alga CLI Configuration Setup($env.ALGA_COLOR_RESET)"
    print "═══════════════════════════════════════════"
    
    # Get user information
    let author_name = (input "Git author name (e.g., John Doe): ")
    let author_email = (input "Git author email (e.g., john@example.com): ")
    
    # Get default edition preference
    print ""
    print "Default edition for dev environments:"
    print "  ce - Community Edition"
    print "  ee - Enterprise Edition"
    let default_edition = (input "Default edition (ce/ee) [ee]: ")
    let edition = if ($default_edition | str trim | is-empty) { "ee" } else { $default_edition }
    
    # Validate edition
    if not ($edition in ["ce", "ee"]) {
        print $"($env.ALGA_COLOR_RED)Invalid edition. Using 'ee' as default.($env.ALGA_COLOR_RESET)"
        let edition = "ee"
    }
    
    # Create configuration
    let config = {
        version: "1.0"
        dev_env: {
            author: {
                name: $author_name
                email: $author_email
            }
            default_edition: $edition
        }
    }
    
    # Save configuration
    save-config $config
    
    print ""
    print $"($env.ALGA_COLOR_GREEN)Configuration initialized successfully!($env.ALGA_COLOR_RESET)"
    print ""
    print "Your configuration:"
    print $"  Author Name:     ($author_name)"
    print $"  Author Email:    ($author_email)"
    print $"  Default Edition: ($edition)"
}

# Display current configuration
export def show-config [] {
    let paths = get-config-path
    let config = load-config
    
    print $"($env.ALGA_COLOR_CYAN)Alga CLI Configuration($env.ALGA_COLOR_RESET)"
    print $"Location: ($paths.file)"
    print "═══════════════════════════════════════════"
    
    if ($paths.file | path exists) {
        print ""
        print "Current configuration:"
        print ($config | to yaml)
    } else {
        print ""
        print $"($env.ALGA_COLOR_YELLOW)No configuration file found.($env.ALGA_COLOR_RESET)"
        print "Run 'nu main.nu config init' to create one."
    }
}