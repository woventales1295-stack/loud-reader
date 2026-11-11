#!/usr/bin/env python3
"""Compile WordNet 3.1 (npm: wordnet-db) into a compact sorted text dictionary: tools/dict/wordnet.txt.gz
line = word \\t sense ¦ sense ...   sense = pos|definition|example|syn,syn
Usage: make_dict.py <path to wordnet-db/dict>"""
import sys, os, re, gzip
d = sys.argv[1]
POS = {"n":"n","v":"v","a":"adj","s":"adj","r":"adv"}
files = {"n":"noun","v":"verb","a":"adj","r":"adv"}
syn = {}   # (pos, offset) -> (words, gloss)
for p, fn in files.items():
    with open(os.path.join(d, "data."+fn), encoding="utf-8") as f:
        for line in f:
            if line.startswith("  "): continue
            head, _, gloss = line.partition(" | ")
            t = head.split(" ")
            off, ss = t[0], t[2]; wc = int(t[3], 16)
            words = []
            for i in range(wc):
                w = t[4+2*i]; w = re.sub(r"\(.*?\)$", "", w); words.append(w)
            syn[(p, off)] = (words, ss, gloss.strip())
entries = {}
for p, fn in files.items():
    with open(os.path.join(d, "index."+fn), encoding="utf-8") as f:
        for line in f:
            if line.startswith("  "): continue
            t = line.split(" ")
            lemma = t[0]
            if "_" in lemma or "-" in lemma or not lemma.isascii(): continue
            pc = int(t[3]); synsets = int(t[2]); offs = t[6+pc:6+pc+synsets]
            senses = []
            for k, off in enumerate(offs[:2]):
                ent = syn.get((p, off)); 
                if not ent: continue
                words, ss, gloss = ent
                parts = [x.strip() for x in gloss.split(";")]
                defs = [x for x in parts if not x.startswith('"')]
                exs = [x.strip('"') for x in parts if x.startswith('"')]
                df = "; ".join(defs)[:220]; ex = (exs[0] if exs and k == 0 else "")[:110]
                others = [w.lower().replace("_"," ") for w in words if w.lower() != lemma][:4]
                pos = POS["s"] if ss == "s" else POS[p]
                senses.append("%s|%s|%s|%s" % (pos, df.replace("|","/"), ex.replace("|","/"), ",".join(others)))
            if senses: entries.setdefault(lemma, []).extend(senses)
lines = []
for w in sorted(entries):
    # keep at most 6 senses per word across parts of speech
    lines.append(w + "\t" + "¦".join(entries[w][:6]))
txt = "\n".join(lines) + "\n"
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "wordnet.txt.gz")
with gzip.open(out, "wb", 9) as g: g.write(txt.encode("utf-8"))
print(len(lines), "words;", len(txt), "bytes raw;", os.path.getsize(out), "bytes gz")
