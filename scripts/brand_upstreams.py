#!/usr/bin/env python3
"""Local UI-only white-label overlay for MIT-licensed sandbox apps.
Maintains original upstream licences and demo disclaimers.
After git submodule update --init --recursive, run from repository root.
"""
from pathlib import Path
import argparse

ROOT = Path(__file__).resolve().parents[1]
PATCHES = {
 "upstreams/neobank/nuxt.config.ts": [("appName: 'NeoBank'", "appName: 'Evolve Bank'"), ("NeoBank — Digital Banking Platform", "Evolve Bank — Banking Sandbox"), ("'#3b5bfd'", "'#087443'")],
 "upstreams/neobank/app/layouts/default.vue": [("brand-mark\">N", "brand-mark\">E"), (">NeoBank</span>", ">Evolve Bank</span>")],
 "upstreams/neobank/app/layouts/auth.vue": [("brand-mark\">N", "brand-mark\">E"), (">NeoBank</span>", ">Evolve Bank</span>")],
 "upstreams/neobank/public/site.webmanifest": [("NeoBank — Digital Banking Platform", "Evolve Bank — Banking Sandbox"), ("\"short_name\": \"NeoBank\"", "\"short_name\": \"Evolve Bank\"")],
 "upstreams/flux/apps/web/src/layouts/brand.tsx": [("aria-label=\"Flux home\"", "aria-label=\"Evolve Bank home\""), ("Flux<span className=\"brand-period\">.</span>", "Evolve Bank<span className=\"brand-period\">.</span>")],
 "upstreams/flux/apps/web/public/index.html": [("Flux — a considered space for your money.", "Evolve Bank — banking sandbox demonstration."), ("Flux · Your money, in focus", "Evolve Bank · Sandbox")],
}
def main():
 parser=argparse.ArgumentParser()
 parser.add_argument('--apply',action='store_true',help='Modify checked-out submodule working copies; default is dry run')
 args=parser.parse_args()
 for rel,replacements in PATCHES.items():
  path=ROOT/rel
  if not path.exists():
   print('SKIP: not cloned:',rel)
   continue
  original=path.read_text(encoding='utf-8')
  modified=original
  for before,after in replacements:
   if before in modified:
    modified=modified.replace(before,after)
   else: print('CHECK: expected source text not found:',rel,repr(before))
  if original==modified:
   print('NO CHANGE:',rel)
  elif not args.apply:
   print('DRY RUN:',rel,'— would rebrand demo presentation only')
  else:
   path.write_text(modified,encoding='utf-8')
   print('BRANDED:',rel)
 print('Never remove upstream licences or the demo/no-real-funds notice.')
if __name__=='__main__': main()
