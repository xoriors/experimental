# Showcase n8n

**Structura proiectului:**

    1. Detectare Cerere: Sistemul n8n monitorizează o adresă de email dedicată și se activează la primirea unei noi cereri.

    2. Extragere Date: Un LLM analizează conținutul emailului pentru a extrage automat datele cheie: Artistul dorit, Data și Detaliile Clientului/Evenimentului.

    3. Verificare Disponibilitate: Sistemul interoghează Google Calendar-ul artistului pentru a verifica dacă data este liberă sau ocupată.
    4. Un LLM analizeaza daca clientul a mentionat ce artist doreste si verifica daca acest artist este unul din cei pe care ii reprezentam(prezenti in googlesheet ul cu terifele artistilor). 
    Daca nu reprezentam artistu, trimitem un mail standardizat care mentioneaza ca nu reprezentam acel artist.
    Daca a mentionat ce artist doreste 5. Verificam daca artistul respectiv este liber in data respectiva.
    Daca nu a mentionat ce artist doreste, 6. Cream un task cu detaliile necesare, stagiul la care ne aflam si datele clientului.

    7. Trimitem un mail catre Artist cu detaliile despre eveniment si astemtam un mesaj de confirmare.

    8. Primim mesaj(folosim telegram) de la artist.
    9. Un LLM incadreaza raspunsul in una din 2 categori: pozitiv; negativ.
    Daca raspunsul este "pozitiv":  10. Trimitem mail standardizat cu tarifele si conditiile artistului.
    Daca raspunsul este "negativ":  Ne intoarcem la pasul 6.
    
    11. Daca primim un mail(din nou continutul va fi analizat de un LLM si va fi incadrat in una din 2 categori: pozitiv; negativ.) si eate pozitiv atunci actualizam calendarul si generam o factura.