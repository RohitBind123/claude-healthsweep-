# Render with: vhs assets/demo.tape   (https://github.com/charmbracelet/vhs)
# Run from the repository root. It drives the real healthsweep CLI on the toy repo in
# examples/demo-repo (see assets/demo/run-demo.sh). No network and no AI agent are needed:
# the finder output is sample data; in a real run the scan agents produce it.

Output assets/demo.gif

Set Shell "bash"
Set Theme "Catppuccin Mocha"
Set FontSize 15
Set Width 1280
Set Height 760
Set Padding 20
Set Framerate 12
Set TypingSpeed 25ms
Set WindowBar Colorful

Hide
Type "export PS1='$ ' && clear"
Enter
Show

Type "DEMO_PAUSE=4 bash assets/demo/run-demo.sh"
Sleep 300ms
Enter

# 7 steps held DEMO_PAUSE seconds each, two of them 2s longer, plus the final hold.
Sleep 43s
