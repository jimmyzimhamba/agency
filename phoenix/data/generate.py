#!/usr/bin/env python3
"""Generate Phoenix demo vault — invented fixtures shaped like Studio X Marketing.

Deterministic: fixed seed, so the graph is identical every run. Safe to
screen-record — no real client data, no real numbers.

Writes markdown files (frontmatter `type:` + [[wikilinks]]) into ./vault_demo/.
Run:  python3 generate.py
"""
import os
import random
import shutil
from datetime import date, timedelta

SEED = 1784729333
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "vault_demo")

random.seed(SEED)

# --- Studio X shaped world -------------------------------------------------
# Three retainer tiers: SME $150, Personal brand $300, Corporate $500 / month.

CLIENTS = [
    # (name, tier, monthly, city, one-line)
    ("Liora Clinic", "SME", 150, "Harare", "Aesthetic & skincare clinic, Borrowdale."),
    ("Free To Be Wild Sanctuary", "Personal brand", 300, "Harare", "Wildlife sanctuary + founder personal brand."),
    ("Kopje Coffee Roasters", "SME", 150, "Harare", "Specialty coffee roastery and cafe."),
    ("Nyasha Moyo", "Personal brand", 300, "Harare", "Public speaker & leadership coach."),
    ("Sable Financial Group", "Corporate", 500, "Harare", "Mid-market financial services firm."),
    ("Mbare Fresh Markets", "SME", 150, "Harare", "Grocery delivery startup."),
    ("Zambezi Timbers Ltd", "Corporate", 500, "Bulawayo", "Timber & building supplies wholesaler."),
    ("Tariro Skincare", "SME", 150, "Harare", "Natural skincare product line."),
    ("Chipo Nkomo", "Personal brand", 300, "Harare", "Fashion designer & creative director."),
    ("Highveld Auto", "SME", 150, "Harare", "Car service & spares."),
]

# People — a contact at most clients, plus a couple of prospects.
PEOPLE = [
    ("Marcus Feld", "Sable Financial Group", "Marketing lead"),
    ("Yasmin Dube", "Zambezi Timbers Ltd", "GM"),
    ("Rutendo Chari", "Liora Clinic", "Owner"),
    ("Tapiwa Ncube", "Kopje Coffee Roasters", "Founder"),
    ("Tendai Marufu", "", "Prospect — law firm"),
    ("Farai Sibanda", "Mbare Fresh Markets", "Ops"),
    ("Ruvimbo Zhou", "", "Prospect — restaurant group"),
    ("Anesu Gwenzi", "Highveld Auto", "Owner"),
    ("Priya Raman", "", "Prospect — dental group"),
    ("Nadia Bell", "", "Prospect — boutique gym"),
]

PROJECTS = [
    ("Liora Q3 Content Engine", "Liora Clinic"),
    ("Sanctuary Donor Campaign", "Free To Be Wild Sanctuary"),
    ("Kopje Launch Reels", "Kopje Coffee Roasters"),
    ("Nyasha Keynote Funnel", "Nyasha Moyo"),
    ("Sable Rebrand Rollout", "Sable Financial Group"),
    ("Mbare App Awareness", "Mbare Fresh Markets"),
    ("Zambezi Trade Campaign", "Zambezi Timbers Ltd"),
    ("Tariro Product Launch", "Tariro Skincare"),
    ("Chipo Lookbook SS26", "Chipo Nkomo"),
    ("Highveld Local SEO", "Highveld Auto"),
    ("Studio X Retainer Ops", ""),
]

CONCEPTS = [
    "Margin model", "Reusable components", "Northbeam Automation",
    "Handover pack", "Discovery call", "Content pillars",
    "UGC pipeline", "Retainer tiers", "Brand voice guide",
    "Reporting cadence", "Ad creative testing", "Referral loop",
    "Onboarding flow", "Reel hook library", "Client health score",
    "Case study kit",
]

SOPS = [
    "SOP — Automation build", "SOP — Proposal", "SOP — Client onboarding",
    "SOP — Monthly report", "SOP — Content approval", "SOP — Invoice & follow-up",
]

# Reusable snippets for realistic body text.
CALL_TOPICS = [
    "audit findings walkthrough", "content plan sign-off", "reel concepts review",
    "ad budget check-in", "invoice follow-up", "scope change request",
    "monthly report review", "new project kickoff", "renewal conversation",
    "creative feedback round",
]
NOTE_TOPICS = [
    "meeting recap", "idea for next campaign", "competitor spotted",
    "pricing thought", "process fix", "quick win",
]

def clean():
    if os.path.isdir(OUT):
        shutil.rmtree(OUT)
    os.makedirs(OUT)

def w(name, frontmatter_type, body, tags=None):
    """Write a markdown file with type frontmatter."""
    safe = name.replace("/", "-")
    path = os.path.join(OUT, f"{safe}.md")
    fm = ["---", f"type: {frontmatter_type}"]
    if tags:
        fm.append("tags: " + ", ".join(tags))
    fm.append("---")
    with open(path, "w") as f:
        f.write("\n".join(fm) + "\n\n")
        f.write(body.strip() + "\n")

def link(name):
    return f"[[{name}]]"

def d(days_ago):
    return (date(2026, 8, 17) - timedelta(days=days_ago)).isoformat()

def build():
    clean()

    # Clients
    for name, tier, monthly, city, blurb in CLIENTS:
        body = (
            f"# {name}\n\n{blurb}\n\n"
            f"- Tier: **{tier}** — ${monthly}/month retainer\n"
            f"- City: {city}\n"
            f"- Owner contact: see people notes\n\n"
            f"Related: {link('Retainer tiers')}, {link('Client health score')}\n"
        )
        w(name, "client", body)

    # People
    for name, client, role in PEOPLE:
        rel = f"Works at {link(client)}." if client else "Prospect — not yet a client."
        body = f"# {name}\n\n{role}. {rel}\n"
        w(name, "person", body)

    # Projects
    for name, client in PROJECTS:
        rel = f"Client: {link(client)}\n" if client else "Internal.\n"
        body = (
            f"# {name}\n\n{rel}\n"
            f"Uses {link('Reusable components')} and {link('Content pillars')}.\n"
        )
        w(name, "project", body)

    # Concepts
    for c in CONCEPTS:
        links = random.sample([p[0] for p in PROJECTS], k=2)
        body = f"# {c}\n\nWorking concept. Applies to {link(links[0])} and {link(links[1])}.\n"
        w(c, "concept", body)

    # SOPs
    for s in SOPS:
        body = (
            f"# {s}\n\nStandard operating procedure.\n\n"
            f"Feeds into {link('Onboarding flow')} and {link('Handover pack')}.\n"
        )
        w(s, "sop", body)

    # Calls — 38, each linking a client + person + sometimes a project
    for i in range(38):
        client = random.choice(CLIENTS)[0]
        person = random.choice([p for p in PEOPLE if p[1] == client] or PEOPLE)[0]
        topic = random.choice(CALL_TOPICS)
        proj = random.choice([p for p in PROJECTS if p[1] == client] or PROJECTS)[0]
        body = (
            f"# Call — {client} — {topic}\n\n"
            f"Date: {d(random.randint(1, 90))}\n\n"
            f"Spoke with {link(person)} at {link(client)} about {topic}. "
            f"Tied to {link(proj)}. Next step logged.\n"
        )
        w(f"Call {i+1:02d} — {client}", "call", body)

    # Notes — 19
    for i in range(19):
        topic = random.choice(NOTE_TOPICS)
        proj = random.choice(PROJECTS)[0]
        body = (
            f"# Note — {topic}\n\nDate: {d(random.randint(1, 120))}\n\n"
            f"{topic.capitalize()} relating to {link(proj)}. "
            f"See also {link(random.choice(CONCEPTS))}.\n"
        )
        w(f"Note {i+1:02d} — {topic}", "note", body)

    # Invoices — 9. Some part-paid because a job is still running (qualifier matters!)
    for i, (name, tier, monthly, city, blurb) in enumerate(CLIENTS[:9]):
        proj = [p for p in PROJECTS if p[1] == name]
        proj_link = link(proj[0][0]) if proj else "retainer"
        running = i % 3 == 0
        amount = monthly
        if running:
            status = (f"**Half-paid — 50%. This is NOT a discount: the {tier} "
                      f"retainer job is still running this month, remainder due on "
                      f"completion.** ${amount//2} of ${amount} received.")
        else:
            status = f"Paid in full. ${amount} of ${amount} received."
        body = (
            f"# Invoice — {name}\n\nDate: {d(random.randint(2, 40))}\n\n"
            f"For {proj_link}. {status}\n"
        )
        w(f"Invoice {i+1:02d} — {name}", "invoice", body)

    # Proposals — 9
    tiers = ["SME $150", "Personal brand $300", "Corporate $500"]
    targets = [c[0] for c in CLIENTS] + ["Priya Raman", "Nadia Bell"]
    for i in range(9):
        who = targets[i % len(targets)]
        tier = tiers[i % 3]
        body = (
            f"# Proposal — {who}\n\nDate: {d(random.randint(1, 30))}\n\n"
            f"Proposed **{tier}/month** retainer to {link(who)}. "
            f"Built from {link('SOP — Proposal')} and {link('Margin model')}.\n"
        )
        w(f"Proposal {i+1:02d} — {who}", "proposal", body)

    # Briefs — 2
    for i, proj in enumerate(random.sample(PROJECTS, 2)):
        body = (
            f"# Brief — {proj[0]}\n\nCreative brief for {link(proj[0])}. "
            f"Voice per {link('Brand voice guide')}.\n"
        )
        w(f"Brief {i+1:02d} — {proj[0]}", "brief", body)

    # Campaign — 1
    body = (
        f"# Campaign — Sanctuary Donor Push\n\n"
        f"Q3 donor campaign for {link('Free To Be Wild Sanctuary')}. "
        f"Runs on {link('Sanctuary Donor Campaign')}, uses {link('Ad creative testing')}.\n"
    )
    w("Campaign 01 — Sanctuary Donor Push", "campaign", body)

    files = len(os.listdir(OUT))
    print(f"Generated {files} demo files in {OUT} (seed {SEED})")

if __name__ == "__main__":
    build()
