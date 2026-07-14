TRANSPORTATION PENALTY TRACKER
==============================

FILES
-----
index.html          Complete login and application
style.css           Professional responsive design
script.js           Authentication, entries, dashboard, calculations, and exports
supabase-config.js  Add your Supabase URL and anon key
database.sql        Tables, school list, RLS policies, trigger, and monthly billing view

SETUP
-----
1. Create a new Supabase project.
2. Open SQL Editor and run database.sql.
3. In Authentication > Users, create each administrator and school user.
4. Run an UPDATE statement from the bottom of database.sql to assign each user's role and school.
5. Open Project Settings > API.
6. Copy the Project URL and anon public key into supabase-config.js.
7. Upload all four web files to GitHub Pages:
      index.html
      style.css
      script.js
      supabase-config.js

PENALTY RULE
------------
First two late incidents in a calendar month: no charge.
Every incident beginning with the third incident: $50.

Examples:
1 incident  = $0
2 incidents = $0
3 incidents = $50
4 incidents = $100
5 incidents = $150

ACCESS
------
School users:
- Enter late buses for their assigned school.
- See all entries they personally submitted.
- Edit and delete their entries.
- Export their entries.

Administrators:
- Enter records for any school.
- See and manage every district entry.
- Filter by month and school.
- See the live billing amount.
- Export district detail and the monthly billing summary.

IMPORTANT
---------
The SQL seed contains 38 school records. Review the names and modify them if your official school list is different.
