import csv, json, re, pathlib
here = pathlib.Path(__file__).parent
rows = list(csv.DictReader(open(here / '../../pipeline/hf_release/places.csv', encoding='utf-8')))
keys = ['id','name','org_type','address','borough','zip','lat','lng','hours','open_evenings','open_weekends','languages','phone','trust','source_url','last_checked']
out = []
for x in rows:
    d = {k: x[k] for k in keys}
    for k in ('lat', 'lng'):
        try: d[k] = float(d[k])
        except ValueError: d[k] = None
    out.append(d)
data = json.dumps(out, ensure_ascii=False, separators=(',', ':'))
(here / 'places.json').write_text(data, encoding='utf-8')
html = (here / 'index.html').read_text(encoding='utf-8')
html = re.sub(r'const PLACES = .*?;\n', 'const PLACES = ' + data.replace('</', '<\\/').replace('\\', '\\\\') + ';\n', html, count=1, flags=re.S)
(here / 'index.html').write_text(html, encoding='utf-8')
print(len(out), 'rows')
