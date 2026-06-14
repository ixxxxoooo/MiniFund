s = open('/tmp/themeweb.js', 'r', encoding='utf-8', errors='replace').read()
out = []
for kw in ['zjlr', 'GetBKDetailInfoNew', 'GetBKRelTopicFundNew', 'push2.eastmoney.com', 'GetZTJJListNew', 'pagesize', 'pageindex', 'pagesize=', 'pn=']:
    idx = -1
    cnt = 0
    while True:
        idx = s.find(kw, idx + 1)
        if idx == -1 or cnt >= 3:
            break
        out.append('\n===== %s @ %d =====' % (kw, idx))
        out.append(s[max(0, idx - 260):idx + 360])
        cnt += 1
open('/Users/liwenjiao/MiniFund/.tmp_inspect_out.txt', 'w', encoding='utf-8').write('\n'.join(out))
print('done', len(out))
