// Minimal sample graph — replace with Konrad's script when you have it.
CREATE (p:Project {name: 'Decisive Alpha', id: 'proj-001'})
CREATE (d:Document {title: 'Sample Handbook', id: 'doc-001'})
CREATE (c:Concept {name: 'Flexible Time Off', acronym: 'FTO'})
CREATE (p)-[:HAS_DOCUMENT]->(d)
CREATE (d)-[:MENTIONS]->(c);
