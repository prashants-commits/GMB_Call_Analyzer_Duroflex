import csv

file_path = "GMB Calls Analyzer - Call details (sample).csv"
with open(file_path, mode='r', encoding='utf-8') as f:
    reader = csv.reader(f)
    headers = next(reader)
    print(f"Headers: {headers}")
    first_row = next(reader)
    print(f"First row: {first_row}")
