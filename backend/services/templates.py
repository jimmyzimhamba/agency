"""
Content library: opening messages, objection counters, follow-up sequences.
Studio X voice: warm, direct, street smart, Zimbabwean. No em dashes.
Short and punchy. Never lead with price. End with one qualifying question.
"""

OPENING_TEMPLATES = {
    "whatsapp": [
        {
            "id": "wa_weakness_direct",
            "label": "Weakness Direct",
            "template": "Hey {first_name}! Saw {business_name} online and noticed {weakness}. "
                        "We help businesses like yours fix that fast -- clients start coming through within weeks. "
                        "Is that something you're actively working on right now?",
        },
        {
            "id": "wa_compliment_hook",
            "label": "Compliment + Hook",
            "template": "Hey {first_name}! {business_name} looks solid -- the kind of business that deserves way more visibility online. "
                        "Quick question: are you happy with the number of new clients you're getting from your digital presence right now?",
        },
        {
            "id": "wa_spotted",
            "label": "I Spotted Something",
            "template": "Hi {first_name} -- Studio X here. I was looking at {business_name}'s online presence and spotted "
                        "something that I think is costing you bookings. Worth a 10-minute chat to show you what I found?",
        },
    ],
    "instagram": [
        {
            "id": "ig_dm_direct",
            "label": "IG DM Direct",
            "template": "Hey! Love what {business_name} is doing. "
                        "I noticed {weakness} -- I help businesses in this space fix that and get a steady flow of clients from social. "
                        "Is your current marketing getting you the results you want?",
        },
        {
            "id": "ig_dm_soft",
            "label": "IG DM Soft Opener",
            "template": "Hi! Came across {business_name}'s page and had to reach out. "
                        "You've got a great offering -- the marketing side just needs a bit of a push. "
                        "Are you open to a quick chat about what's working online right now?",
        },
    ],
    "facebook": [
        {
            "id": "fb_dm_direct",
            "label": "Facebook DM",
            "template": "Hi {first_name}! I came across {business_name} and noticed {weakness}. "
                        "We're a marketing agency based here in Zim and we specialize in helping businesses like yours "
                        "get more clients online. Would you be open to a quick call this week?",
        },
    ],
    "email": [
        {
            "id": "email_audit",
            "label": "Audit Email",
            "template": "Subject: Quick question about {business_name}'s online presence\n\n"
                        "Hi {first_name},\n\n"
                        "I came across {business_name} recently and ran a quick audit of your online presence. "
                        "I found {weakness} -- and I think it's costing you real bookings every week.\n\n"
                        "We're Studio X Marketing (studioxmarketing.com) and we help businesses in Zimbabwe fix exactly this. "
                        "Our clients typically see a measurable increase in leads within 60 days.\n\n"
                        "Worth a 15-minute call to show you what I found and what we'd do about it?\n\n"
                        "Best,\n{sender_name}\nStudio X Marketing\nstudioxmarketing.com",
        },
        {
            "id": "email_referral",
            "label": "Referral Style",
            "template": "Subject: Someone mentioned {business_name}\n\n"
                        "Hi {first_name},\n\n"
                        "A contact of mine mentioned {business_name} as one of the better operators in your space in Harare -- "
                        "which is exactly why I'm reaching out.\n\n"
                        "I noticed {weakness} when I looked you up, and I think there's a real opportunity to close that gap "
                        "before your competitors do.\n\n"
                        "We're Studio X (studioxmarketing.com) and we work specifically with businesses like yours. "
                        "Are you open to a quick call this week?\n\n"
                        "{sender_name}\nStudio X Marketing",
        },
    ],
    "linkedin": [
        {
            "id": "li_connection",
            "label": "LinkedIn Opener",
            "template": "Hi {first_name}, came across {business_name} and was impressed by what you've built. "
                        "I noticed {weakness} -- I help businesses in this space strengthen their digital presence and get more clients. "
                        "Open to connecting and comparing notes?",
        },
    ],
    "call": [
        {
            "id": "call_script",
            "label": "Call Script",
            "template": "Hi, is this {first_name}? Great -- my name is {sender_name} from Studio X Marketing. "
                        "I was looking at {business_name} online and I noticed {weakness}. "
                        "I work with businesses like yours to fix that and get more clients coming through the door. "
                        "Is now an okay time for a quick 5 minutes?",
        },
    ],
}

OBJECTION_COUNTERS = [
    {
        "id": "obj_do_own_socials",
        "objection": "We already do our own socials",
        "response": "That's great -- and honestly most businesses I work with do too. "
                    "The question is whether it's actually converting to bookings or just keeping the page alive. "
                    "What results are you seeing from it right now?",
    },
    {
        "id": "obj_no_budget",
        "objection": "We don't have budget right now",
        "response": "Totally hear you. Most of my clients said the same thing before we started. "
                    "The way I structure it, the first month usually pays for itself. "
                    "Can I ask -- what's one client booking worth to your business on average?",
    },
    {
        "id": "obj_send_proposal",
        "objection": "Just send me a proposal / email",
        "response": "I could do that -- but a proposal without context is just noise in your inbox. "
                    "Give me 10 minutes on a call and I'll show you exactly what I found and what the fix looks like. "
                    "Then you can decide if a proposal even makes sense. Does that sound fair?",
    },
    {
        "id": "obj_tried_agency",
        "objection": "We tried an agency before and it didn't work",
        "response": "That's one of the most common things I hear -- and honestly, a lot of agencies deserve that reputation. "
                    "What went wrong with them? I want to make sure we don't repeat it.",
    },
    {
        "id": "obj_referrals",
        "objection": "We get all our clients by referral",
        "response": "Referrals are gold -- you've clearly built something people trust. "
                    "The question is, what happens when referrals slow down or a competitor starts showing up online for your name? "
                    "Are you comfortable with referrals being your only channel?",
    },
    {
        "id": "obj_think_about_it",
        "objection": "Let me think about it",
        "response": "Of course -- I'd rather you make the right call than rush. "
                    "What specifically would you need to think through? "
                    "If it's about results, I can share what we've done for similar businesses here in Zim.",
    },
    {
        "id": "obj_how_much",
        "objection": "How much does it cost?",
        "response": "Good question -- and I'll be straight with you: it depends on what you actually need. "
                    "Some clients are on $300/month, some are on $1,500. "
                    "The honest answer is I don't want to quote you a number until I understand your business. "
                    "What I can tell you is we do payment plans and we tie our fees to results. "
                    "Can we do a 15-minute call so I can give you a real number?",
    },
    {
        "id": "obj_economy",
        "objection": "ZESA / the economy is tough right now",
        "response": "I hear you -- everyone's dealing with it. "
                    "What I've found is that when things are tight, businesses that show up online clearly are the ones that survive. "
                    "Your competitors who go quiet right now are actually handing you market share. "
                    "What would one extra solid client per month do for you?",
    },
]

FOLLOW_UP_SEQUENCE = [
    {
        "touch": 1,
        "day": 1,
        "label": "Same-day follow up",
        "template": "Hey {first_name} -- just checking this landed okay. "
                    "Happy to share exactly what I spotted on {business_name}'s page if it's easier to jump on a quick call.",
    },
    {
        "touch": 2,
        "day": 4,
        "label": "Day 4 value nudge",
        "template": "Hi {first_name} -- I know things get busy. "
                    "Quick one: I put together a 3-point audit of {business_name}'s online presence. "
                    "Worth a 10-minute chat before the week's out?",
    },
    {
        "touch": 3,
        "day": 10,
        "label": "Final nudge",
        "template": "Last message from me, {first_name}. "
                    "The gap I spotted in {business_name}'s marketing is still there -- which means your competitors could close it first. "
                    "Worth a look when you're free?",
    },
]

WHY_STUDIO_X = (
    "Studio X Marketing (studioxmarketing.com) is a Harare-based digital marketing agency. "
    "We specialize in helping appointment-based businesses and high-ticket service providers "
    "get more clients through strategic digital marketing -- not vanity metrics. "
    "We're local, we understand the Zimbabwe market, and we tie our work to real business outcomes."
)


def get_library() -> dict:
    return {
        "opening_templates": OPENING_TEMPLATES,
        "objection_counters": OBJECTION_COUNTERS,
        "follow_up_sequence": FOLLOW_UP_SEQUENCE,
        "why_studio_x": WHY_STUDIO_X,
    }
