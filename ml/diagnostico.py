import requests

for q in ['artist:"The Weeknd" track:"Blinding Lights"', 'The Weeknd Blinding Lights']:
    r = requests.get('https://api.deezer.com/search', params={'q': q, 'limit': 3}, timeout=10)
    print(q)
    print(r.status_code, r.text[:300])
    print()