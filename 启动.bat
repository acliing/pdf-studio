@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
set PYTHONIOENCODING=utf-8
set PYTHONUTF8=1
title Paperly PDF

where python >nul 2>nul
if errorlevel 1 goto NO_PYTHON

python -c "import fitz, PIL" >nul 2>nul
if errorlevel 1 goto INSTALL_DEPS
goto RUN

:NO_PYTHON
echo.
echo   Python was not found.
echo   Install Python 3.10 or newer, and enable "Add Python to PATH".
echo.
pause
exit /b 1

:INSTALL_DEPS
echo.
echo   First run: installing local dependencies (PyMuPDF, Pillow)...
echo.
python -m pip install -r requirements.txt
if errorlevel 1 goto INSTALL_FAILED
goto RUN

:INSTALL_FAILED
echo.
echo   Dependency installation failed.
echo   Run this command manually: python -m pip install -r requirements.txt
echo.
pause
exit /b 1

:RUN
python server.py %*
if errorlevel 1 (
  echo.
  echo   The local service exited with an error. See the message above.
  pause
)
