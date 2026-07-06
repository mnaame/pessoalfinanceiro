@echo off
title Meu Financeiro
rem Entra na pasta onde este arquivo esta (funciona de qualquer lugar)
cd /d "%~dp0"
rem Abre o navegador depois de 2 segundos, enquanto o servidor sobe
start "" cmd /c "timeout /t 2 >nul & start http://localhost:3000"
echo.
echo  ============================================
echo   Meu Financeiro — servidor ligado!
echo   Acesse:  http://localhost:3000
echo   Para desligar: feche esta janela (ou Ctrl+C)
echo  ============================================
echo.
npm start
pause
