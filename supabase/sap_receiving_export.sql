-- Export réception SAP — avril à juin 2026
-- Résultat : 1 ligne = 1 employé × 1 jour × nombre de lignes réceptionnées
-- Exporter en CSV/Excel → TCAP → Import réception
--
-- Règles métier :
--   OPDN : réceptions directes vers entrepôts 01 et 03 (exclut ASN via filtre entrepôt)
--   OWTR : transferts ASN dépôt 02 → entrepôts 01/03

SELECT
  "DocDate",
  "U_NAME" AS "Employé",
  COUNT(*) AS "Lignes"
FROM (
  SELECT
    A."DocDate",
    C."U_NAME"
  FROM OPDN A
  LEFT JOIN PDN1 B ON A."DocEntry" = B."DocEntry"
  LEFT JOIN OUSR C ON A."UserSign" = C."INTERNAL_K"
  WHERE A."DocDate" >= '20260401'
    AND A."DocDate" <= '20260630'
    AND B."WhsCode" IN ('01', '03')

  UNION ALL

  SELECT
    A."DocDate",
    C."U_NAME"
  FROM OWTR A
  LEFT JOIN WTR1 B ON A."DocEntry" = B."DocEntry"
  LEFT JOIN OUSR C ON A."UserSign" = C."INTERNAL_K"
  WHERE A."DocDate" >= '20260401'
    AND A."DocDate" <= '20260630'
    AND B."FromWhsCod" = '02'
    AND B."WhsCode" IN ('01', '03')
) T
GROUP BY "DocDate", "U_NAME"
ORDER BY "DocDate", "U_NAME";

-- Optionnel : filtrer employés entrepôt côté SAP
-- WHERE "U_NAME" IN ('Roxane Hrycyk', 'Stéphane Archambault', 'Sylvain Daunais')
