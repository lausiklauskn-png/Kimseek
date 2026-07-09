# sbkim/

Hier liegt die **öffentliche** Visitenkarte des Knotens: `spore.json`.

Sie wird **im Browser** erzeugt (Siegel-Modal → 🔑 Eigene Identität & Spore →
Spore signieren + herunterladen) und dann hierher committet. Sie enthält nur
öffentliche Daten (nodeId, öffentlicher Schlüssel, Domänen-Vektor, Signatur) —
**niemals** den privaten Schlüssel oder ein Backup (siehe `.gitignore`).
