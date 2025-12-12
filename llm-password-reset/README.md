# **Semantic Zero-Knowledge-Like Proof**

Proposing a move from Syntactic Authentication (exact string matching) to Semantic Authentication (meaning-based matching).
This approach allows for "fuzzy" logic, where the user proves they possess specific memories or knowledge without having to act like a robot memorizing an exact, case-sensitive phrase.

Experiment on how we could use llms maybe with RAG and embeddings to handle the reset pass functionality with a secret question you set but instead of needed to write the word as an answer the setup would be like this
- when you define the secret question you would explain to an llm your answer like writing about an event in your life or information you want to have as answer
- then when you need to reset pass you could be shown the question of some hint and you would respond the same describing the answer but not necessary with the same wording or words order like when you defined it, but should be on the same like
- then llm compares the answer you defined before with the one you give now and confirm in percentage that you are actually the holder of the account

We can use https://platform.claude.com/docs/en/agent-sdk/overview

See more details https://gemini.google.com/share/f9a6075f22d1

[See Issue #4](https://github.com/xoriors/experimental/issues/4)

## **How to Run GUARD Locally**

### **1. Prerequisites**

Make sure you work inside an environment that has these installed:

``` bash
python3 -m venv .venv
source .venv/bin/activate
pip install fastapi uvicorn bcrypt openai
```

Also, verify to have `ngrok-v3` installed. If not, install by running following commands inside Linux terminal:

``` bash
cd ~
wget https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-linux-amd64.tgz
tar -xvzf ngrok-v3-stable-linux-amd64.tgz
sudo mv ngrok /usr/local/bin/
```

Add the **authentication token** for `ngrok` by running:

``` bash
ngrok config add-authtoken $(AUTH_TOKEN)
```

---

### **2. Run the local FastAPI server**

In your terminal:

``` bash
uvicorn guard_server:app --reload --port 8000
```

This command starts FastAPI locally at: `http://127.0.0.1:8000`. Here, you will see live logs of requests and responses.

---

### **3. Expose it to the Internet (with `ngrok`)**

Open another *terminal window* and run:

```bash
ngrok http 8000
```

If everything was correct so far, `ngrok` should return you a public HTTPS URL like: `https://something.ngrok.io`.

You can now send **API requests** from anywhere using that URL instead of localhost.

---

### **4. Using the API**

#### **POST/enroll**

Enrolls a new user with password and phrases (array of strings).

##### **Request example**:

```bash
curl -X POST "http://127.0.0.1:8000/enroll" \
  -H "Content-Type: application/json" \
  -d '{
        "user_id": "user1",
        "password": "StrongPass123!",
        "phrases": ["open sesame", "blue moon", "night watch"]
      }'
```

##### **Response**:

```json
{"status": "enrolled"}
```

##### **Notes**:

- Storing only **hashes** inside `guard_data.txt`.
- Rejects duplicate enrollments for same user ID.

---

#### **POST/verify**

Checks whether a given phrase matches any enrolled phrase.

##### **Request example**:

```bash
curl -X POST "http://127.0.0.1:8000/verify" \
  -H "Content-Type: application/json" \
  -d '{
        "user_id": "user1",
        "phrase": "blue moon"
      }'
```

##### **Response**:

- On success:

```json
{"authorized": true}
```

- On wrong phrase : `HTTP 401 - Denied`;
- Too many failures (set to 5) : `HTTP 429 - Too many failed attempts`;
- Suspicious words like `password`, `hint` etc. : `HTTP 403 - Session closed for security reasons`.

---

### **5. Data file (`guard_data.txt`)**

Structure:

```json
{
  "user1": {
    "password_hash": "$2b$12$...",
    "phrases": ["3d6f0c9b...", "1f9a7a1e..."],
    "locked_until": 0,
    "attempts": 0
  }
}
```

---





