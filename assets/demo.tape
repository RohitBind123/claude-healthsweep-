# Render with: vhs assets/demo.tape   (https://github.com/charmbracelet/vhs)
# Run it from the root of a clean git repo that has a healthsweep config, with the plugin installed.
# The real run waits for your answers at the cost gate and at each fix; edit the Sleep values to fit.

Output assets/demo.gif

Set Shell "bash"
Set Theme "Catppuccin Mocha"
Set FontSize 18
Set Width 1200
Set Height 720
Set Padding 24
Set TypingSpeed 45ms
Set WindowBar Colorful

Hide
Type "clear"
Enter
Show

Type "git status --short && echo 'clean tree'"
Sleep 400ms
Enter
Sleep 1.5s

Type "claude"
Sleep 400ms
Enter
Sleep 4s

Type "/healthsweep --scope src --no-tier3"
Sleep 600ms
Enter

# Config, preflight, baseline checks, Tier 2 scan.
Sleep 30s

# Cost gate: pick the first option (verify findings at or above the threshold).
Enter
Sleep 45s

# Per-fix approval: review the diff and test output, then choose.
Sleep 8s
Enter
Sleep 20s

# Final report.
Sleep 10s
