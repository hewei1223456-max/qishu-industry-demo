@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
set "QISHU_NODE="
for /d %%R in ("%ProgramFiles%\WindowsApps\OpenAI.CodexPrimaryRuntime*") do (
  if exist "%%~R\dependencies\node\bin\node.exe" (
    set "QISHU_NODE=%%~R\dependencies\node\bin\node.exe"
    if not defined QISHU_PYTHON set "QISHU_PYTHON=%%~R\dependencies\python\python.exe"
  )
)
if not defined QISHU_NODE if exist "%ProgramFiles%\nodejs\node.exe" set "QISHU_NODE=%ProgramFiles%\nodejs\node.exe"
if not defined QISHU_NODE for /f "delims=" %%N in ('where node.exe 2^>nul') do if not defined QISHU_NODE set "QISHU_NODE=%%N"
if not defined QISHU_NODE (
  echo 未找到Node.js，请安装Node.js 24后重试。
  goto end
)
"%QISHU_NODE%" -e "if(Number(process.versions.node.split('.')[0])<24){console.error('需要Node.js 24或以上');process.exit(1)}"
if errorlevel 1 goto end
"%QISHU_NODE%" --env-file-if-exists=.env apps/server/src/server.js
:end
pause
