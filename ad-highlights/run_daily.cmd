@echo off
REM Daily wrapper used by the scheduled task. Logs go to logs\YYYY-MM-DD.log (and task.log for launcher issues).
setlocal
cd /d "%~dp0"
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8

REM Optional: set to 1 to let Claude Code write a short editorial digest next to the report
REM (needs `claude` on PATH and a logged-in Claude Code CLI). The pipeline itself never calls Claude.
set USE_CLAUDE_DIGEST=0

where py >nul 2>nul && (set PY=py -3) || (set PY=python)
echo [%date% %time%] starting ad-highlights >> task.log
%PY% highlights.py %* >> task.log 2>&1
set RC=%ERRORLEVEL%
echo [%date% %time%] finished with exit code %RC% >> task.log

if "%USE_CLAUDE_DIGEST%"=="1" if exist out\latest.md (
  claude -p "You are helping pick TikTok clips that showcase Ability Draft ability combos. Read the highlight report below and write a 10-line digest: the 5 moments most likely to look spectacular on video (favour visible combos over raw kill counts), each with match id, clock time, hero and a one-line hook I could use as a caption. Plain text." < out\latest.md > out\latest-digest.md 2>> task.log
)
exit /b %RC%
