from __future__ import annotations


def _copy(en: str, scn: str, it: str) -> dict[str, str]:
    return {"en": en, "scn": scn, "it": it}


TRANSLATIONS: dict[str, dict[str, str]] = {
    "brand.tagline": _copy(
        "Sicilian media uploads",
        "Carricamenti di media siciliani",
        "Caricamenti di contenuti siciliani",
    ),
    "language.label": _copy("Language", "Lingua", "Lingua"),
    "aria.highlights": _copy("Highlights", "Punti principali", "Punti principali"),
    "aria.account_access": _copy("Account access", "Accessu ô cuntu", "Accesso all'account"),
    "aria.account_action": _copy("Account action", "Azzioni dû cuntu", "Azione account"),
    "aria.primary_navigation": _copy("Primary navigation", "Navigazzioni principali", "Navigazione principale"),
    "aria.submission_history": _copy("Previous submissions", "Mannati pricidenti", "Invii precedenti"),
    "home.eyebrow": _copy("A living archive", "N'archiviu vivu", "Un archivio vivo"),
    "home.title": _copy(
        "Preserve Sicily in its own voices.",
        "Cunservamu la Sicilia ntê so vuci.",
        "Conserviamo la Sicilia attraverso le sue voci.",
    ),
    "home.intro": _copy(
        "Contribute interviews, oral histories, performances, and everyday recordings to a shared cultural collection.",
        "Manna ntirvisti, storî urali, spittàculi e riggistrazzioni d'ogni jornu a na ricota culturali cumuni.",
        "Contribuisci con interviste, storie orali, esibizioni e registrazioni quotidiane a una raccolta culturale condivisa.",
    ),
    "home.audio": _copy("Audio and video welcome", "Audio e vìdiu accittati", "Audio e video accettati"),
    "home.private": _copy(
        "Your submissions stay tied to your account.",
        "Li to mannati arrèstanu lijati ô to cuntu.",
        "I tuoi invii restano collegati al tuo account.",
    ),
    "auth.title": _copy(
        "Sign in or create account",
        "Trasi o crìa un cuntu",
        "Accedi o crea un account",
    ),
    "auth.intro": _copy(
        "Enter your email and we will send you a six-digit code.",
        "Scrivi la to email e ti mannaremu un còdici di sei nùmmari.",
        "Inserisci la tua email e ti invieremo un codice di sei cifre.",
    ),
    "auth.email": _copy("Email address", "Nnirizzu email", "Indirizzo email"),
    "auth.email.action": _copy(
        "Email me a code", "Mànnami un còdici", "Inviami un codice"
    ),
    "auth.code.title": _copy(
        "Check your email", "Cuntrolla la to email", "Controlla la tua email"
    ),
    "auth.code.sent": _copy(
        "We sent a six-digit code to",
        "Mannamu un còdici di sei nùmmari a",
        "Abbiamo inviato un codice di sei cifre a",
    ),
    "auth.code": _copy("Six-digit code", "Còdici di sei nùmmari", "Codice di sei cifre"),
    "auth.code.help": _copy(
        "The code expires in 10 minutes and can be used once.",
        "Lu còdici scadi tra 10 minuti e si po usari na vota sula.",
        "Il codice scade tra 10 minuti e può essere usato una sola volta.",
    ),
    "auth.verify.action": _copy("Continue", "Cuntinua", "Continua"),
    "auth.resend": _copy("Send a new code", "Manna un còdici novu", "Invia un nuovo codice"),
    "auth.change_email": _copy("Change email", "Cancia email", "Cambia email"),
    "auth.code.resent": _copy(
        "A new code is on its way.",
        "Un còdici novu sta arrivannu.",
        "Un nuovo codice è in arrivo.",
    ),
    "nav.history": _copy("Previous submissions", "Mannati pricidenti", "Invii precedenti"),
    "nav.new": _copy("New submission", "Novu mannatu", "Nuovo invio"),
    "nav.account": _copy("Signed in as", "Trasutu comu", "Accesso come"),
    "nav.logout": _copy("Sign out", "Nesci", "Esci"),
    "new.eyebrow": _copy("Contribute", "Cuntribbuisci", "Contribuisci"),
    "new.title": _copy("Upload a file", "Càrrica un file", "Carica un file"),
    "new.intro": _copy(
        "Select one audio or video file and add its details.",
        "Scigghi un file audio o vìdiu e junci li dittagghi.",
        "Seleziona un file audio o video e aggiungi i dettagli.",
    ),
    "form.title": _copy("Title", "Tìtulu", "Titolo"),
    "form.title.help": _copy(
        "Give the recording a short, descriptive name.",
        "Duna â riggistrazzioni un nomu curtu e chiaru.",
        "Dai alla registrazione un nome breve e descrittivo.",
    ),
    "form.notes": _copy("Notes", "Noti", "Note"),
    "form.optional": _copy("optional", "facultativu", "facoltativo"),
    "form.notes.help": _copy(
        "Add context such as place, speakers, date, or subject.",
        "Junci cuntestu comu locu, parraturi, data o argumentu.",
        "Aggiungi informazioni come luogo, persone, data o argomento.",
    ),
    "form.file": _copy("Audio or video file", "File audio o vìdiu", "File audio o video"),
    "form.drop": _copy(
        "Drop a file here or choose from your device",
        "Lassa ccà un file o pigghialu dû to dispusitivu",
        "Trascina qui un file o sceglilo dal dispositivo",
    ),
    "form.selected": _copy("Selected file", "File scigghiutu", "File selezionato"),
    "form.formats": _copy(
        "MP4, MOV, WebM, MKV, AVI, MP3, WAV, M4A, AAC, FLAC, OGG, or Opus.",
        "MP4, MOV, WebM, MKV, AVI, MP3, WAV, M4A, AAC, FLAC, OGG o Opus.",
        "MP4, MOV, WebM, MKV, AVI, MP3, WAV, M4A, AAC, FLAC, OGG oppure Opus.",
    ),
    "form.limit": _copy("Maximum file size", "Grannizza màssima", "Dimensione massima"),
    "form.submit": _copy("Submit recording", "Manna la riggistrazzioni", "Invia registrazione"),
    "form.uploading": _copy("Uploading…", "Carricamentu…", "Caricamento…"),
    "form.progress": _copy("Upload progress", "Prugressu dû carricamentu", "Avanzamento del caricamento"),
    "success.eyebrow": _copy("Submission received", "Mannatu arricivutu", "Invio ricevuto"),
    "success.title": _copy("Upload complete", "Carricamentu cumpletu", "Caricamento completato"),
    "success.message": _copy(
        "Your file was uploaded successfully.",
        "Lu file fu carricatu currettamenti.",
        "Il file è stato caricato correttamente.",
    ),
    "success.title_label": _copy("Title", "Tìtulu", "Titolo"),
    "success.file_label": _copy("File", "File", "File"),
    "success.another": _copy("Submit another file", "Manna n'àutru file", "Invia un altro file"),
    "history.eyebrow": _copy("Your archive", "Lu to archiviu", "Il tuo archivio"),
    "history.title": _copy("Previous submissions", "Mannati pricidenti", "Invii precedenti"),
    "history.intro": _copy(
        "Files you have uploaded.",
        "Li file ca carricasti.",
        "I file che hai caricato.",
    ),
    "history.empty": _copy(
        "You have not submitted a recording yet. Use New submission in the navigation when you are ready.",
        "Nun mannasti ancora nudda riggistrazzioni. Quannu sì prontu, aḍḍòpira Novu mannatu ntâ barra.",
        "Non hai ancora inviato registrazioni. Quando vuoi, usa Nuovo invio nella navigazione.",
    ),
    "history.title_col": _copy("Title", "Tìtulu", "Titolo"),
    "history.file_col": _copy("Original file", "File urigginali", "File originale"),
    "history.date_col": _copy("Submitted", "Mannatu", "Inviato"),
    "error.summary": _copy("Please check the following:", "Cuntrolla sti cosi:", "Controlla quanto segue:"),
    "error.email": _copy("Enter a valid email address.", "Scrivi un nnirizzu email vàlidiu.", "Inserisci un indirizzo email valido."),
    "error.code_invalid": _copy("Enter the valid six-digit code.", "Scrivi lu còdici vàlidiu di sei nùmmari.", "Inserisci il codice valido di sei cifre."),
    "error.code_expired": _copy("This code has expired. Request a new one.", "Stu còdici scadìu. Addumànnani unu novu.", "Questo codice è scaduto. Richiedine uno nuovo."),
    "error.code_attempts": _copy("Too many incorrect attempts. Request a new code later.", "Troppi tintativi sbagghiati. Addumanna un còdici novu cchiù tardu.", "Troppi tentativi errati. Richiedi un nuovo codice più tardi."),
    "error.rate_limit": _copy("Please wait before requesting another code.", "Aspetta prima d'addumannari n'àutru còdici.", "Attendi prima di richiedere un altro codice."),
    "error.email_send": _copy("We could not send the code. Please try again.", "Nun pûtemu mannari lu còdici. Prova arrè.", "Non è stato possibile inviare il codice. Riprova."),
    "error.csrf": _copy("Your form expired. Refresh the page and try again.", "Lu mòdulu scadìu. Attualizza la pàggina e prova arrè.", "Il modulo è scaduto. Aggiorna la pagina e riprova."),
    "error.title_required": _copy("Add a title for the recording.", "Junci un tìtulu â riggistrazzioni.", "Aggiungi un titolo alla registrazione."),
    "error.title_long": _copy("The title must be 160 characters or fewer.", "Lu tìtulu havi a èssiri di 160 caràttari o menu.", "Il titolo deve contenere al massimo 160 caratteri."),
    "error.notes_long": _copy("Notes must be 2,000 characters or fewer.", "Li noti hannu a èssiri di 2.000 caràttari o menu.", "Le note devono contenere al massimo 2.000 caratteri."),
    "error.file_required": _copy("Choose an audio or video file.", "Scigghi un file audio o vìdiu.", "Scegli un file audio o video."),
    "error.file_type": _copy("This file format is not supported.", "Stu tipu di file nun è suppurtatu.", "Questo formato di file non è supportato."),
    "error.file_size": _copy("The file is larger than the allowed limit.", "Lu file è cchiù granni dû lìmiti pirmisu.", "Il file supera il limite consentito."),
    "error.file_empty": _copy("The selected file is empty.", "Lu file scigghiutu è vacanti.", "Il file selezionato è vuoto."),
    "error.repository": _copy("We could not store the file. Please try again.", "Nun pûtemu sarvari lu file. Prova arrè.", "Non è stato possibile salvare il file. Riprova."),
}
