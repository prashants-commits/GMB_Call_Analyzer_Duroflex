import os
from google import genai
client = genai.Client(api_key="AIzaSyD1CKkkfBpdJCjvfNXIV0fAtPs2lz5Or1A")
try:
    for m in client.models.list():
        print(m.name)
except Exception as e:
    print("FAILED:", e)