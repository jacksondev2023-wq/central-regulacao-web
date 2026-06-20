@echo off
setlocal

cd /d "%~dp0"

for /f %%I in ('powershell -NoProfile -Command "(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '169.254*' -and $_.IPAddress -ne '127.0.0.1' } | Select-Object -First 1 -ExpandProperty IPAddress)"') do set LAN_IP=%%I

echo.
echo Central de Regulacao - demo para equipe
echo.
echo Local: http://127.0.0.1:8080
if defined LAN_IP echo Rede:  http://%LAN_IP%:8080
echo.
echo Visao geral: Diego ou Akaua / PIN 1234
echo Atendentes: PIN 1234
echo.
echo Mantenha esta janela aberta enquanto estiver demonstrando.
echo Para encerrar a demo, feche esta janela.
echo.

npm.cmd run share

pause
