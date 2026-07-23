from pathlib import Path
p = Path('public/app.js')
text = p.read_text(encoding='utf-8')
counts = {c:0 for c in '(){}[]`'}
for ch in text:
    if ch in counts:
        counts[ch]+=1
print('counts:', counts)
# find last 50 lines
lines = text.splitlines()
print('\n--- tail (last 80 lines) ---')
for i,l in enumerate(lines[-80:], start=len(lines)-80+1):
    print(f"{i}: {l}")
# simple stack check for braces
pairs = {')':'(', '}':'{', ']':'['}
stack = []
line_num = 1
for i,ch in enumerate(text):
    if ch=='\n':
        line_num+=1
        continue
    if ch in '({[':
        stack.append((ch,line_num))
    elif ch in ')}]':
        if not stack:
            print('Unmatched closing', ch, 'at char', i, 'line', line_num)
            break
        top, l = stack.pop()
        if top != pairs[ch]:
            print('Mismatched', top, 'vs', ch, 'at line', line_num)
            break
else:
    if stack:
        print('Unmatched openings remain, top 5:', stack[-5:])
    else:
        print('All braces matched')
