"""Builds Stratrix into ../payday-app-hq (the GitHub Pages site)."""
import re, shutil, os
OUT = '/home/claude/payday-app-hq'
t = open('template.html').read()
strip = lambda s: re.sub(r"\nif \(typeof module !== 'undefined'\).*", "", s)
for tag, f in (("ENGINE", "engine.js"), ("DEFAULTS", "defaults_blank.js"), ("XLSX", "xlsx.js"), ("APP", "app.js")):
    t = t.replace(f"/*{tag}*/", strip(open(f).read()))
head = '''<meta name="theme-color" content="#146356" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#171710" media="(prefers-color-scheme: dark)">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="icon-192.png">
<link rel="apple-touch-icon" href="icon-192.png">
'''
t = t.replace('<link rel="preconnect"', head + '<link rel="preconnect"', 1)
t = t.replace('</body>', '''<script>if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) addEventListener('load', () => navigator.serviceWorker.register('sw.js'));</script>
</body>''')
open(f'{OUT}/index.html', 'w').write(t)
os.makedirs(f'{OUT}/src', exist_ok=True)
for f in ('engine.js', 'defaults_blank.js', 'xlsx.js', 'app.js', 'template.html', 'build.py'):
    shutil.copy(f, f'{OUT}/src/{f}')
print('built', len(t))
