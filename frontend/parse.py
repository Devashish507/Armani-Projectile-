import json

try:
    with open('lint.json', 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    with open('errors.txt', 'w', encoding='utf-8') as out:
        for file_data in data:
            if file_data['errorCount'] > 0:
                out.write(f"\n{file_data['filePath']}\n")
                for msg in file_data['messages']:
                    if msg['severity'] == 2:
                        out.write(f"  Line {msg['line']}:{msg['column']} - {msg['message']}\n")
except Exception as e:
    with open('errors.txt', 'w', encoding='utf-8') as out:
        out.write(f"Error: {e}")
