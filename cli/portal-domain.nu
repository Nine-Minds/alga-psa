#!/usr/bin/env nu

use "utils.nu" [find-project-root parse-flag check-flag]

export def portal-domain-sessions-prune [
    ...args: string
] {
    let tenant = (parse-flag $args "--tenant")
    let minutes_value = (parse-flag $args "--minutes")
    let older_than = if $minutes_value == null {
        (parse-flag $args "--older-than-minutes")
    } else {
        $minutes_value
    }
    let dry_run = (check-flag $args "--dry-run")

    let minutes = if $older_than == null {
        "10"
    } else {
        $older_than
    }

    let project_root = (find-project-root)
    mut args_list = [
        "tsx"
        "scripts/portal-domain-sessions-prune.ts"
        "--older-than-minutes"
        $minutes
    ]

    if $tenant != null {
        $args_list = $args_list ++ ["--tenant" $tenant]
    }

    if $dry_run {
        $args_list = $args_list ++ ["--dry-run"]
    }

    let result = (
        cd $"($project_root)/server";
        ^npx ...$args_list | complete
    )

    if $result.exit_code != 0 {
        error make { msg: $"($env.ALGA_COLOR_RED)Failed to prune portal domain OTT sessions: ($result.stderr)($env.ALGA_COLOR_RESET)" }
    }

    print $result.stdout
}
