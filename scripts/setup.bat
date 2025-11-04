@echo off
REM Setup script for Resolution Auto-Mapper on Windows

echo ============================================================
echo Resolution Auto-Mapper Setup
echo ============================================================
echo.

echo Checking Python installation...
python --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Python is not installed or not in PATH
    echo Please install Python 3.8 or higher from https://www.python.org/
    pause
    exit /b 1
)

echo Python is installed.
echo.

echo Installing dependencies...
pip install -r requirements.txt
if errorlevel 1 (
    echo ERROR: Failed to install dependencies
    pause
    exit /b 1
)

echo.
echo ============================================================
echo Setup Complete!
echo ============================================================
echo.
echo You can now run the mapper with:
echo   python resolution_mapper.py --known path\to\known.png --unknown path\to\unknown.png
echo.
echo See README.md for usage instructions.
echo.
pause
