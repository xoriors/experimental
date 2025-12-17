# **Semantic Zero-Knowledge-Like Proof**

Proposing a move from Syntactic Authentication (exact string matching) to Semantic Authentication (meaning-based matching).
This approach allows for "fuzzy" logic, where the user proves they possess specific memories or knowledge without having to memorize an exact, case-sensitive phrase.

Experiment on how we could use `LLMs` with embeddings to handle the reset pass functionality with a secret question you set but instead of needed to write the word as an answer the setup would look like this:
- when you define the secret question you would explain to an `LLM` your answer like writing about an event in your life or information you want to have as answer;
- then when you need to reset pass you could be shown the question or some hint and you would respond the same describing the answer but not necessary with the same wording or word order as when you defined it, but should present similar meaning;
- then `LLM` compares the answer you defined before with the one you give now and confirm in percentage that you are actually the holder of the account.

**GUARD** : https://chatgpt.com/g/g-692e07d058048191b018d764bc75d71d-g-u-a-r-d

See more details : https://gemini.google.com/share/f9a6075f22d1

[See Issue #4](https://github.com/xoriors/experimental/issues/4)

## **How to Run GUARD Locally**

### 1. Prerequisites

Clone the repository and navigate to the project folder:

```bash
git clone https://github.com/xoriors/experimental.git
cd experimental/llm-password-reset
```

Make sure you work inside an environment that has these installed:

``` bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
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

### 2. Run the local FastAPI server

In your terminal:

``` bash
uvicorn guard_server:app --reload --port 8000
```

This command starts FastAPI locally at: `http://127.0.0.1:8000`. Here, you will see live logs of requests and responses.

### 3. Expose it to the Internet (with `ngrok`)

Open another *terminal window* and run:

```bash
ngrok http 8000
```

If everything was correct so far, `ngrok` should return you a public HTTPS URL like: `https://something.ngrok.io`.

You can now send **API requests** from anywhere using that URL instead of localhost.

## **How to Run GUARD Using Docker**

### 1. Prerequisites
Ensure you have **Docker Desktop** installed and running.
* [Download Docker Desktop](https://www.docker.com/products/docker-desktop/)

### 2. Setup the Project
Clone the repository and navigate to the project folder:

```bash
git clone https://github.com/xoriors/experimental.git
cd experimental/llm-password-reset
```

### 3. Ensure Security

You must create a local environment file to store your Ngrok authentication token securely. This file is ignored by igt to protect your privacy.

```bash
echo "NGROK_AUTHTOKEN=your_actual_token_here" > .env
```

### 4. Build and run

Use Docker Compose to build the backend image and start the tunnel automatically.

```bash
docker-compose up --build
```

## **Endpoints**

### **GET /user/{user_id}**

Checks if a specific *user ID* exists in the database and retrieves their current account status (e.g., `locked`/`active`).

#### Request Example:

```bash
curl -X GET "https://<your-ngrok-url>/user/tudor"
```

#### Response Example:

1. User exists

```json
{
  "exists": boolean, 
  "is_locked": boolean, 
  "locked_until": timestamp
}
```

2. User not found : `HTTPException(404, "User not found")`

---

### **POST /enroll**

Enrolls a new user by hashing their password and converting their semantic passphrases into vector embeddings.

#### Logic

1. Validates password strength.
2. Hashes the password using `bcrypt`.
3. Uses `sentence-transformers` (SBERT) to convert each passphrase into a 384-dimensional vector.
4. Discards the raw text of the phrases immediately (Zero-Knowledge).

#### Request example:

```bash
curl -X POST "https://<your-ngrok-url>/enroll" \
  -H "Content-Type: application/json" \
  -d '{
        "user_id": "user1",
        "password": "StrongPassword123!",
        "phrases": [
          "The old oak tree in my backyard where I built a fort",
          "My first car was a red convertible from the 90s"
        ]
      }'
```

#### Response example:

```json
{"status": "enrolled"}
```

---

### **POST /verify**

Verifies a user's identity by comparing the semantic meaning of their input against stored embeddings (or exact match using old password).

#### Logic

1. Converts `input_text` into a vector (embedding).
2. Calculates **cosine similarity** against all stored vectors for that user.
3. Determines status based on thresholds:
  - > above 0.80: `authorized` (high confidence).
  - > 0.65 - 0.80: `ambiguous` (needs clarification).
  - > below 0.65: `denied`.

#### Request example:

```bash
curl -X POST "https://<your-ngrok-url>/verify" \
  -H "Content-Type: application/json" \
  -d '{
        "user_id": "user1",
        "input_text": "The tree where I had a fort",
        "auth_type": "phrase"
      }'
```

#### Response Example:

1. Success (Authorized)

```json
{
  "status": "authorized",
  "score": 0.89,
  "message": "Identity verified."
}
```

2. Ambiguous (Request Clarification) 

``` json
{
  "status": "ambiguous", 
  "message": "Verification unclear. Request clarification.",
  "score": 0.74
}
```

*GUARD is trained to ask a follow-up question when it sees this status.*

3. Failure (Denied)

```json
{
  "status": "denied",
  "score": 0.45,
  "message": "Access denied."
}
```

---

### **POST /update**

Updates the credentials (password) for an existing user. This endpoint is called **only** after the user has successfully completed the Semantic Verification or Password Verification phase.

#### Logic

1. Checks if the user exists.
2. Hashes the **new_password** using `bcrypt`(Salted).
3. Overwrites the old password hash in the `users` table.

#### Request Example:

```json
curl -X POST "https://<your-ngrok-url>/update" \
  -H "Content-Type: application/json" \
  -d '{
        "user_id": "tudor",
        "new_password": "NewSuperSecurePassword456!"
      }'
```

#### Response Example:

```json
{
  "status": "updated",
  "message": "Password updated successfully."
}
```


## **Database Structure**

File Location: `./guard_secure.db` (inside the Docker container volume).

- >TABLE 1: **USERS**

Stores authentication credentials and security counters (locking mechanism).

| Column | Type | Description |
| :--- | :--- | :--- |
| `user_id` | `TEXT (PK)` | Unique username. |
| `password_hash` | `TEXT` | Bcrypt salted hash. |
| `locked_until` | `REAL` | Timestamp for when the account unlock (0 if unlocked). |
| `attempts` | `INTEGER` | Counter for failed login attempts. |

- >TABLE 2: **PASSPHRASES**

Stores the semantic memory of the user. Raw text is never stored here.

| Column | Type | Description |
| :--- | :--- | :--- |
| `user_id` | `TEXT (FK)` | Links to the `users` table. |
| `phrase` | `TEXT` | **The serialized Vector Embedding** (JSON string of floats). |

- >TABLE 3: **AUTH_CONTEXT**

This table acts as the **Short-Term Memory** for the system. It handles the `ambiguous` flow by temporarily saving the state of a verification attempt.

| Column | Type | Description |
| :--- | :--- | :--- |
| `user_id` | `TEXT (PK)` | The user attempting verification. |
| `partial_phrase` | `TEXT` | The first (ambiguous) input provided by the user. |
| `timestamp` | `REAL` | Unix timestamp of when the attempt started. |

**How it works**: When a user gives a vague answer, their input is saved here. When they reply to the clarification question, the system retrieves this last_input, combines it with the new answer, and performs a final check. This entry is deleted immediately after the check finishes (One-Strike Policy).

## **Frontend: Custom GPT Architecture**

Instead of a traditional website, the "Frontend" is a **Custom GPT** (ChatGPT Agent) named **GUARD**, configured to act as a secure conversational interface.

### 1. Architecture & System Instructions
The GPT acts as a secure intermediary between the user and the Python backend. It operates on a strict **System Prompt** that enforces security protocols, Zero-Knowledge handling, and the ambiguity resolution flow.

### 2. Configuration Setup
To recreate the frontend agent in ChatGPT:

* **Actions Schema:** Use the `guard_openapi.yaml` file provided in this repository (exported from FastAPI). This defines how the GPT talks to your endpoints (`/enroll`, `/verify`, etc.).
* **Server URL:** Set to your public Ngrok address (e.g., `https://xyz.ngrok-free.app`).
* **Authentication:** None (OpenAPI); the backend handles user authentication semantically.

### 3. Privacy Policy (Required)
Since the Agent handles user data, a Privacy Policy is hosted on **GitHub Gist**.
* **Function:** Informs users that passphrases are converted to **Zero-Knowledge Vectors** and raw text is never stored.
* **Implementation:** The Gist URL is added to the GPT's privacy settings to comply with OpenAI policies.



