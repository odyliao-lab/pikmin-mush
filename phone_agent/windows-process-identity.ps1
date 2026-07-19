function Test-PikminHeadlessToken {
    param(
        [Parameter(Mandatory = $true)][string]$CommandLine,
        [Parameter(Mandatory = $true)][string]$Token
    )
    $pattern = '(?i)(?:^|\s)"?' + [regex]::Escape($Token) + '"?(?=\s|$)'
    return $CommandLine -match $pattern
}

function Test-PikminHeadlessCommandLine {
    param(
        [Parameter(Mandatory = $true)][string]$CommandLine,
        [Parameter(Mandatory = $true)][string]$Serial,
        [string]$Marker = '',
        [ValidateSet('', 'virtual', 'screen-off')][string]$LegacyMode = ''
    )

    $serialPattern = '(?i)(?:^|\s)"?--serial(?:=|\s+)"?' +
        [regex]::Escape($Serial) + '"?(?=\s|$)'
    if ($CommandLine -notmatch $serialPattern) { return $false }

    if ($Marker) {
        return (Test-PikminHeadlessToken $CommandLine "--window-title=$Marker")
    }

    if ($LegacyMode -eq 'virtual') {
        $required = @(
            '--stay-awake', '--no-audio', '--window-title=PikminHeadlessDisplay',
            '--new-display=720x1600/320', '--start-app=com.nianticlabs.pikmin',
            '--keep-active', '--max-fps=1', '--video-bit-rate=100K',
            '--window-x=-2000', '--window-y=-2000', '--window-width=64', '--window-height=64'
        )
    } elseif ($LegacyMode -eq 'screen-off') {
        $required = @(
            '--stay-awake', '--no-audio', '--turn-screen-off', '--no-window',
            '--max-size=640', '--max-fps=2'
        )
    } else {
        return $false
    }

    foreach ($token in $required) {
        if (-not (Test-PikminHeadlessToken $CommandLine $token)) { return $false }
    }
    return $true
}
