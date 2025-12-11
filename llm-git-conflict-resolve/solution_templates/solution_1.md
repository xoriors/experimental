# Git Merge Conflict Prompt for AI Agents

Acest proiect defineste un skill pentru Claude Code Agent, conceput pentru a detecta si rezolva conflicte Git merge. Skill-ul ofera instructiuni clare, proceduri bine definite si unelte auxiliare pentru a ajuta agentul sa interpreteze fisiere aflate in conflict si sa genereze o versiune finala corecta, fara marcaje de conflict.

## Obiectiv

Skill-ul are ca scop furnizarea unui set complet de instructiuni prin care un AI agent poate:

- Detecta conflictele din fisiere.
- Identifica structura markerelor Git (`<<<<<<<`, `=======`, `>>>>>>>`).
- Extrage sectiunile aflate in conflict.
- Analiza diferentele dintre variantele HEAD si branch.
- Aplica diverse strategii de merge (automata, preferinta pentru HEAD, preferinta pentru branch, semantica).
- Apela cod Python auxiliar pentru analize mai avansate.
- Genera o rezolvare finala coerenta.
- Rescrie fisierul final fara conflicte.

Agentul nu utilizeaza comenzi Git propriu-zise. Toate operatiunile se bazeaza exclusiv pe procesarea textului, conform instructiunilor din acest skill.

---

# Continutul skill-ului

Structura skill-ului este formata din trei componente principale: fisierul de logica (`skill.md`), scriptul auxiliar (`merge_utils.py`) si documentatia de utilizare (`usage.md`).

## 1. `skill.md` – Instructiunile principale

Acest fisier defineste comportamentul agentului si regulile pe care trebuie sa le urmeze in timpul rezolvarii conflictelor.

### Ce contine

- Descrierea scopului skill-ului.
- Explicarea pasilor operationali obligatorii.
- Definirea clara a modului de detectare si extragere a conflictelor.
- Regulile de analiza si de aplicare a strategiilor de merge.
- Instructiuni despre cum sa utilizeze codul auxiliar Python.
- Exemple de input si output pentru a ghida agentul.

### Pasii operationali

1. Identificarea marcajelor de conflict:
   ```
   <<<<<<< HEAD
   ...
   =======
   ...
   >>>>>>> branch
   ```
2. Extractia celor doua sectiuni in structura:
   ```json
    { 
        "HEAD": "...", 
        "branch": "..." 
    }
   ```
3. Analiza diferentelor dintre sectiuni.
4. Aplicarea unei strategii de merge, conform instructiunilor si contextului.
5. Generarea unei rezolvari finale.
6. Daca este necesar, apelarea scriptului Python (`merge_utils.py`) pentru:
   - detectarea conflictelor,
   - comparari avansate,
   - analiza semantica.
7. Interpretarea outputului JSON primit de la script.
8. Reconstruirea fisierului final fara marcaje de conflict.

### Strategii de merge documentate

- Strategie automata: daca una dintre versiuni este continuta in cealalta.
- Preferinta HEAD: agentul pastreaza versiunea din HEAD.
- Preferinta branch: agentul pastreaza versiunea din branch.
- Merge semantic:
  - reconstructie JSON,
  - combinarea functiilor in cod atunci cand modificarile nu sunt conflictuale.
- Merge asistat: agentul solicita utilizatorului o alegere explicita.

### Exemple

Skill-ul trebuie sa includa exemple de conflicte si rezolvarile lor, astfel incat agentul sa inteleaga formatul asteptat.

---

## 2. `merge_utils.py` – Cod Python auxiliar

Acest script este destinat operatiunilor care sunt mai eficiente sau mai sigure atunci cand sunt executate ca program local. Agentul il poate apela in mod explicit in timpul procesului.

### Functionalitati posibile

- `detect_conflicts(file_text)` identifica toate sectiunile conflictuale dintr-un fisier si intoarce o structura JSON.
- `three_way_merge(base, ours, theirs)` implementeaza logica unui merge in trei sensuri.
- `ast_merge_python(ours, theirs)` realizeaza un merge semantic asupra functiilor Python.
- `json_merge(ours, theirs)` combina structuri JSON intr-un mod sigur.
- `line_similarity(a, b)` ofera un scor de similaritate intre linii pentru decizii automatizate.

### Format de output recomandat

```json
{
  "conflicts": [
    {
      "start_line": 42,
      "end_line": 68,
      "HEAD": "...",
      "branch": "...",
      "type": "text"
    }
  ]
}
```

---

## 3. `usage.md` – Documentatie de utilizare

Fisierul `usage.md` explica modul corect de utilizare al skill-ului, atat pentru agent, cat si pentru utilizator.

### Continut

- Instructiuni despre cum trebuie apelat scriptul Python.
- Formatele acceptate pentru input.
- Modul de interpretare al outputului.
- Exemple complete de rulare.
- Conventii stabilite intre agent si script (argumente CLI, structuri JSON, etc.).

---

# Concluzie

Skill-ul ofera o metodologie completa pentru rezolvarea conflictelor Git fara a utiliza Git in mod direct. Documentatia din `skill.md` deserveste drept ghid operational pentru agent, `merge_utils.py` furnizeaza suport tehnic avansat, iar `usage.md` clarifica modul de interactiune cu skill-ul. Acest set de fisiere permite agentului sa detecteze, interpreteze si combine eficient sectiunile aflate in conflict, oferind o versiune finala curata si coerenta.
