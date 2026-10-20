"""FINDER 1 — company_case_study_customers (ruling 64).
Reads the PROSPECT's own public site: homepage -> links to customers / case studies /
success stories -> collects the customer names those pages show (logo alt text, case-study
slugs and headings). Output: candidate names + evidence URL per prospect. The production
version adds one LLM pass to clean the list; here the cleaning pass is reviewed by hand."""
import json,re,subprocess,sys,html as H
from urllib.parse import urljoin,urlparse
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/128 Safari/537.36"
def get(u):
    p=subprocess.run(["curl","-sSL","-m","25","-A",UA,u],capture_output=True,text=True)
    return p.stdout
KEY=re.compile(r'(customer|case[-_ ]?stud|success[-_ ]?stor|client|testimonial)',re.I)
BAD=re.compile(r'(login|sign|careers|privacy|terms|support|portal|cookie|contact|mailto|#)',re.I)
def candidates(domain):
    home=get(f"https://www.{domain}") or get(f"https://{domain}")
    base=f"https://www.{domain}/"
    links=[]
    for href,txt in re.findall(r'<a[^>]+href="([^"]+)"[^>]*>(.*?)</a>',home,re.S):
        t=re.sub(r'<[^>]+>',' ',txt)
        if KEY.search(href+' '+t) and not BAD.search(href):
            u=urljoin(base,href)
            if urlparse(u).netloc.replace('www.','')==domain and u not in links: links.append(u)
    names={}
    for u in links[:4]:
        page=get(u)
        for alt in re.findall(r'<img[^>]+alt="([^"]{2,60})"',page):
            a=H.unescape(alt).strip()
            a=re.sub(r'(?i)\b(logo|logotype|icon|image|customer|client)\b','',a).strip(' -|:')
            if 2<len(a)<40 and not re.search(r'(?i)'+domain.split('.')[0],a) and a.lower() not in {'arrow','search','close','shape','play','quote','plus','minus','menu','feed'}: names.setdefault(a,u)
        # case-study pages named after the customer: /case-studies/barilla/, /resource/caseys-elevate-case-study/
        for slug in re.findall(r'href="[^"]*/(?:case-stud(?:y|ies)|customers|customer-stories|success-stories|resource)/([a-z0-9-]{3,70})/?(?:#[^"]*)?"',page):
            if '/resource/' in page and 'case' not in slug and 'stor' not in slug and 'case-stud' not in u: continue
            n=re.sub(r'-?(elevate-)?(case-study|customer-story|story)$','',slug)
            n=re.sub(r'^(top-\d+-)','',n).replace('-',' ').strip()
            if n and not re.search(r'(?i)^(page|category|tag|all|index|feed|numu case study)$',n): names.setdefault(n.title(),u)
        # featured story headlines: "How Lovesac built ..."
        for m in re.findall(r'How ([A-Z][A-Za-z0-9&\'. ]{1,30}?) (?:built|used|uses|cut|grew|scaled|turned|reduced|increased|achieved)',re.sub(r'<[^>]+>',' ',page)):
            names.setdefault(m.strip(),u)
    return {'domain':domain,'pages_read':links[:4],'candidates':names}
if __name__=='__main__':
    out=[candidates(d) for d in sys.argv[1:]]
    json.dump(out,open('finder1_raw.json','w'),indent=1)
    for o in out:
        print('\n###',o['domain'],'| pages:',len(o['pages_read']),'| candidates:',len(o['candidates']))
        for p in o['pages_read']: print('   page:',p)
        print('  ',list(o['candidates'].keys())[:40])
