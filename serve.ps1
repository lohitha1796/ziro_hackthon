# serve.ps1 - minimal zero-dependency static file server for the demo.
# Usage:  powershell -ExecutionPolicy Bypass -File serve.ps1 -Port 8777
# Then open http://localhost:8777/ in a browser.
# The app also works when opened directly from the file system; this server is only
# needed if you want an http origin (for example to use the http transport mode).

param(
  [int]$Port = 8777,
  [string]$Root = $PSScriptRoot
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path $Root).Path
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "Serving $root"
Write-Host "http://localhost:$Port/"

$types = @{
  '.html' = 'text/html; charset=utf-8'
  '.js'   = 'application/javascript; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.md'   = 'text/markdown; charset=utf-8'
  '.svg'  = 'image/svg+xml'
  '.png'  = 'image/png'
}

try {
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    try {
      $rel = $ctx.Request.Url.LocalPath.TrimStart('/')
      if ([string]::IsNullOrWhiteSpace($rel)) { $rel = 'index.html' }
      $rel = $rel -replace '/', '\'
      $path = Join-Path $root $rel
      $full = [System.IO.Path]::GetFullPath($path)
      if (-not $full.StartsWith($root)) {
        $ctx.Response.StatusCode = 403
        $ctx.Response.OutputStream.Close()
        continue
      }
      if (Test-Path $full -PathType Leaf) {
        $bytes = [System.IO.File]::ReadAllBytes($full)
        $ext = [System.IO.Path]::GetExtension($full).ToLower()
        if ($types.ContainsKey($ext)) { $ctx.Response.ContentType = $types[$ext] }
        else { $ctx.Response.ContentType = 'application/octet-stream' }
        # A demo server that always serves the current file avoids "why is my edit not
        # showing" confusion when the page is reloaded after a change.
        $ctx.Response.Headers.Add('Cache-Control', 'no-store, must-revalidate')
        $ctx.Response.StatusCode = 200
        $ctx.Response.ContentLength64 = $bytes.Length
        $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
        Write-Host ("200 " + $ctx.Request.HttpMethod + " " + $ctx.Request.Url.LocalPath)
      } else {
        $bytes = [System.Text.Encoding]::UTF8.GetBytes("404 not found: $rel")
        $ctx.Response.StatusCode = 404
        $ctx.Response.ContentType = 'text/plain; charset=utf-8'
        $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
        Write-Host ("404 " + $ctx.Request.Url.LocalPath)
      }
    } finally {
      $ctx.Response.OutputStream.Close()
    }
  }
} finally {
  $listener.Stop()
  $listener.Close()
}
