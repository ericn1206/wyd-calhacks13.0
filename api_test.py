import google.generativeai as genai
genai.configure(api_key="AQ.Ab8RN6JqEwAVZnkrxhc2yoY5wg3zO9tLSXXvDTmD3QvdL2NrYw", transport="rest")
m = genai.GenerativeModel("gemini-3.8-flash")
print(m.generate_content("say hi", request_options={"timeout": 60}).text)