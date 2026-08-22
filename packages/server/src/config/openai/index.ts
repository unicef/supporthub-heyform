const FORM_INTERFACES = `
Field kind values:
- welcome, thank_you, statement
- short_text, long_text, number, yes_no
- multiple_choice, picture_choice, file_upload
- opinion_scale, rating, date, date_range, time
- input_table, payment, full_name, address, email, url
- phone_number, country_selector, signature, legal_terms

Field JSON shape:
{
  "id": "12-character id",
  "title": ["Question title"],
  "description": [],
  "kind": "short_text",
  "validations": {},
  "properties": {},
  "layout": null
}

"validations" ACCEPTS ONLY THESE FOUR KEYS. Any other key is rejected:
  required (boolean), min (number), max (number), matchExpected (boolean)
There is no format, max_length, min_length, pattern or email/url validation key.
Use "email" or "url" as the field KIND instead, and min/max for length limits.

"properties" ACCEPTS ONLY THESE KEYS. Any other key is rejected:
  showButton, buttonText, hideMarks, allowOther, allowMultiple, badge,
  verticalAlignment, choices, randomize, choiceStyle, other, numberPreRow,
  shape, total, start, leftLabel, centerLabel, rightLabel, defaultCountryCode,
  currency, price, format, allowTime, use12Hours, tableColumns, score,
  sourceUrl, buttonLinkUrl, redirectUrl, redirectOnCompletion, redirectDelay
There is no allowed_file_types, max_files or any other key. All keys are
camelCase — never snake_case.

"choices" and "tableColumns" are arrays of OBJECTS, never of strings:
  "choices": [{ "id": "12-character id", "label": "Low" }]
  NOT "choices": ["Low"]

Required properties per kind. These kinds are INVALID with empty properties:

- multiple_choice, picture_choice:
  { "allowMultiple": false, "verticalAlignment": true,
    "choices": [ { "id": "12-character id", "label": "A real option" },
                 { "id": "12-character id", "label": "Another real option" } ] }
  At least two choices; every label non-empty.
- yes_no:
  { "choices": [ { "id": "12-character id", "label": "Yes" },
                 { "id": "12-character id", "label": "No" } ] }
- rating:        { "total": 5, "shape": "star" }
- opinion_scale: { "total": 10 }
- date, date_range: { "format": "MM/DD/YYYY", "allowTime": false }
- phone_number:  { "defaultCountryCode": "US" }
- payment:       { "currency": "USD", "price": { "type": "number", "value": 0 } }
- input_table:
  { "tableColumns": [ { "id": "12-character id", "label": "A real column" },
                      { "id": "12-character id", "label": "Another real column" } ] }

All other kinds take "properties": {}. file_upload takes {} — it has no
configurable properties.

Every "id" must be a distinct 12-character alphanumeric string.
`

const LOGIC_INTERFACES = `
Logic JSON shape:
[
  {
    "fieldId": "field id",
    "payloads": [
      {
        "id": "12-character id",
        "condition": {
          "comparison": "is",
          "expected": "value"
        },
        "action": {
          "kind": "navigate",
          "fieldId": "target field id"
        }
      }
    ]
  }
]

Supported comparisons include is, is_not, contains, does_not_contain, starts_with,
ends_with, equal, not_equal, greater_than, less_than, greater_or_equal_than,
less_or_equal_than, is_before, is_after, is_empty, and is_not_empty.
Supported action kinds are navigate and calculate.
`

export function createFormPrompt(topic: string, reference?: string): string {
  return `
${FORM_INTERFACES}

Create a form for this request:
${topic}

${
  reference
    ? `Use this reference material when helpful:
${reference}`
    : ''
}

Return only JSON. Do not output markdown or explanation.
Generate 5 to 20 fields. Match the language of the request.
Use this exact JSON shape:
{
  "name": "form name",
  "fields": [
    {
      "id": "2sgLirFD41ZP",
      "title": ["title here"],
      "description": [],
      "kind": "short_text",
      "validations": {},
      "properties": {},
      "layout": null
    }
  ]
}
`
}

export function createFieldsPrompt(name: string, questions: unknown, prompt: string): string {
  return `
${FORM_INTERFACES}

The form name is:
${name}

The current questions are:
${JSON.stringify(questions)}

User request:
${prompt}

Return only JSON. Do not output markdown or explanation.
Only edit specified questions, insert/create new questions at requested locations, or reorder questions.
If new questions are created without a specified position, place them at the end.
Match the language of the request.
Return a JSON array of fields.
`
}

export function createLogicsPrompt(questions: unknown, logics: unknown, prompt: string): string {
  return `
${FORM_INTERFACES}
${LOGIC_INTERFACES}

The current questions are:
${JSON.stringify(questions)}

The existing logics are:
${JSON.stringify(logics || [])}

User request:
${prompt}

Return only JSON. Do not output markdown or explanation.
Only add, modify, or delete logic for specified questions.
Return all logics as a JSON array.
`
}

export function createThemePrompt(theme: string, prompt: string): string {
  return `
Allowed Google fonts:
Inter, Public Sans, Montserrat, Alegreya, B612, Muli, Titillium Web, Varela,
Vollkorn, IBM Plex Mono, Crimson Text, Cairo, BioRhyme, Karla, Lora,
Frank Ruhl Libre, Playfair Display, Archivo, Spectral, Fjalla One, Roboto,
Rubik, Source Sans Pro, Cardo, Cormorant, Work Sans, Rakkas, Concert One,
Yatra One, Arvo, Lato, Abril Fatface, Ubuntu, PT Serif, Old Standard TT,
Oswald, Open Sans, Courier Prime, Poppins, Josefin Sans, Fira Sans, Nunito,
Exo 2, Merriweather, Noto Sans.

Current theme:
${theme}

User request:
${prompt}

Return only JSON. Do not output markdown or explanation.
Create or edit the theme using this JSON shape:
{
  "fontFamily": "Inter",
  "questionTextColor": "#000000",
  "answerTextColor": "#000000",
  "buttonBackground": "#000000",
  "buttonTextColor": "#ffffff",
  "backgroundColor": "#ffffff"
}
`
}
