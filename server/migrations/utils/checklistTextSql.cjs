'use strict';

// Persist the Unicode data with the format version: database locale must not change rule matches.
const unicode = require('./checklistUnicodeLower.v1.json');
const whitespace =
  ' \t\n\r\v\f\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff';
const literal = (value) => `'${value.replace(/'/g, "''")}'`;

exports.installChecklistTextFunctions = async function installChecklistTextFunctions(knex) {
  await knex.raw(`CREATE OR REPLACE FUNCTION alga_predicate_lower_v1(input text) RETURNS text
    LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE AS $fn$
    DECLARE chars text[] := string_to_array(input, NULL); output text[] := '{}';
      current text; previous_cased boolean := false; next_cased boolean; j integer;
    BEGIN
      IF input = '' THEN RETURN ''; END IF;
      FOR i IN 1..cardinality(chars) LOOP
        current := chars[i];
        IF current = 'Σ' THEN
          next_cased := false; j := i + 1;
          WHILE j <= cardinality(chars) LOOP
            IF chars[j] COLLATE "C" !~ ${literal(unicode.ignorable)} THEN
              next_cased := chars[j] COLLATE "C" ~ ${literal(unicode.cased)}; EXIT;
            END IF;
            j := j + 1;
          END LOOP;
          output[i] := CASE WHEN previous_cased AND NOT next_cased THEN 'ς' ELSE 'σ' END;
        ELSIF current = 'İ' THEN output[i] := ${literal(unicode.expand['İ'])};
        ELSE output[i] := translate(current, ${literal(unicode.upper)}, ${literal(unicode.lower)});
        END IF;
        IF current COLLATE "C" !~ ${literal(unicode.ignorable)} THEN previous_cased := current COLLATE "C" ~ ${literal(unicode.cased)}; END IF;
      END LOOP;
      RETURN array_to_string(output, '');
    END $fn$`);

  // Interpret visible inline content, never JSON keys, styles, URLs or other metadata.
  await knex.raw(`CREATE OR REPLACE FUNCTION alga_checklist_inline_text_v1(nodes jsonb) RETURNS text
    LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $fn$
    DECLARE node jsonb; props jsonb; result text := '';
    BEGIN
      IF jsonb_typeof(nodes) IS DISTINCT FROM 'array' THEN RETURN ''; END IF;
      FOR node IN SELECT value FROM jsonb_array_elements(nodes) LOOP
        IF node->>'type' = 'mention' THEN
          props := COALESCE(node->'props', node->'attrs', '{}'::jsonb);
          result := result || CASE WHEN COALESCE(props->>'username', '') <> '' THEN '@' || (props->>'username')
            ELSE '@[' || COALESCE(NULLIF(props->>'displayName', ''), 'Unknown') || ']' END;
        ELSIF node->>'type' = 'link' THEN result := result || alga_checklist_inline_text_v1(node->'content');
        ELSIF jsonb_typeof(node->'text') = 'string' THEN result := result || (node->>'text');
        ELSE result := result || alga_checklist_inline_text_v1(node->'content'); END IF;
      END LOOP;
      RETURN result;
    END $fn$`);
  await knex.raw(`CREATE OR REPLACE FUNCTION alga_checklist_pm_text_v1(node jsonb) RETURNS text
    LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $fn$
    DECLARE child jsonb; pieces text[] := '{}'; delimiter text := ''; result text := '';
    BEGIN
      IF jsonb_typeof(node) IS DISTINCT FROM 'object' THEN RETURN ''; END IF;
      IF node->>'type' = 'text' THEN RETURN COALESCE(node->>'text', ''); END IF;
      IF node->>'type' IN ('hard_break', 'hardBreak') THEN RETURN chr(10); END IF;
      IF node->>'type' IN ('bullet_list','ordered_list','bulletList','orderedList','list_item','listItem','blockquote','doc')
        THEN delimiter := ' '; END IF;
      IF jsonb_typeof(node->'content') = 'array' THEN
        FOR child IN SELECT value FROM jsonb_array_elements(node->'content') LOOP
          pieces := array_append(pieces, alga_checklist_pm_text_v1(child));
        END LOOP;
        RETURN array_to_string(pieces, delimiter);
      END IF;
      RETURN COALESCE(node->>'text', '');
    END $fn$`);
  await knex.raw(`CREATE OR REPLACE FUNCTION alga_checklist_blocks_text_v1(nodes jsonb) RETURNS text
    LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $fn$
    DECLARE node jsonb; row jsonb; cell jsonb; rows text[]; cells text[]; pieces text[] := '{}'; text_value text;
    BEGIN
      IF jsonb_typeof(nodes) IS DISTINCT FROM 'array' THEN RETURN ''; END IF;
      FOR node IN SELECT value FROM jsonb_array_elements(nodes) LOOP
        IF node->>'type' = 'table' THEN
          rows := '{}';
          FOR row IN SELECT value FROM jsonb_array_elements(CASE WHEN jsonb_typeof(node->'content'->'rows') = 'array'
            THEN node->'content'->'rows' ELSE '[]'::jsonb END) LOOP
            cells := '{}';
            FOR cell IN SELECT value FROM jsonb_array_elements(CASE WHEN jsonb_typeof(row->'cells') = 'array'
              THEN row->'cells' ELSE '[]'::jsonb END) LOOP
              cells := array_append(cells, alga_checklist_inline_text_v1(cell));
            END LOOP;
            rows := array_append(rows, array_to_string(cells, ' | '));
          END LOOP;
          text_value := array_to_string(rows, chr(10));
        ELSIF jsonb_typeof(node->'content') = 'string' THEN text_value := node->>'content';
        ELSE text_value := alga_checklist_inline_text_v1(node->'content'); END IF;
        pieces := array_append(pieces, text_value);
        IF jsonb_typeof(node->'children') = 'array' AND jsonb_array_length(node->'children') > 0 THEN
          pieces := array_append(pieces, alga_checklist_blocks_text_v1(node->'children'));
        END IF;
      END LOOP;
      RETURN array_to_string(pieces, ' ');
    END $fn$`);
  await knex.raw(`CREATE OR REPLACE FUNCTION alga_checklist_description_v1(attributes jsonb) RETURNS text
    LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $fn$
    DECLARE raw text; result text; value jsonb;
    BEGIN
      IF jsonb_typeof(attributes) = 'string' THEN
        BEGIN attributes := (attributes #>> '{}')::jsonb;
        EXCEPTION WHEN invalid_text_representation THEN RETURN NULL; END;
      END IF;
      value := attributes->'description';
      IF jsonb_typeof(value) = 'string' THEN
        raw := value #>> '{}';
        IF btrim(raw, ${literal(whitespace)}) = '' THEN RETURN NULL; END IF;
        IF left(ltrim(raw, ${literal(whitespace)}), 1) IN ('[', '{') THEN
          BEGIN value := raw::jsonb;
          EXCEPTION WHEN invalid_text_representation THEN RETURN raw; END;
        ELSE RETURN raw; END IF;
      END IF;
      IF jsonb_typeof(value) = 'array' THEN result := alga_checklist_blocks_text_v1(value);
      ELSIF value->>'type' = 'doc' THEN result := alga_checklist_pm_text_v1(value);
      ELSE RETURN NULL; END IF;
      RETURN CASE WHEN btrim(result, ${literal(whitespace)}) = '' THEN NULL ELSE result END;
    END $fn$`);
};
