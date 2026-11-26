export function getStudentStream(user) {
  return String(user?.stream || "").toLowerCase() === "social" ? "social" : "natural";
}

export function getSubjectDiscipline(subj) {
  if (!subj) return "";
  const code = String(subj.code || "").toUpperCase();
  const name = String(subj.name || "").toLowerCase();

  if (code.includes("BIO") || name.includes("bio")) return "BIO";
  if (code.includes("CHEM") || name.includes("chem")) return "CHEM";
  if (code.includes("PHYS") || name.includes("phys")) return "PHYS";
  if (code.includes("MATH") || name.includes("math")) return "MATH";
  if (code.includes("ENG") || name.includes("eng")) return "ENG";
  if (code.includes("GEOG") || name.includes("geog")) return "GEOG";
  if (code.includes("HIST") || name.includes("hist")) return "HIST";
  if (code.includes("ECON") || name.includes("econ")) return "ECON";
  if (code.includes("APTITUDE") || name.includes("aptitude") || code.includes("SAT") || name.includes("sat")) {
    return "SAT";
  }

  return code.split("_")[0] || code;
}

export function subjectSupportsGrade(subject, grade) {
  const levels = String(subject?.gradeLevel || "").match(/\d+/g)?.map(Number) || [];
  return (
    !levels.length ||
    (levels.length > 1
      ? grade >= Math.min(...levels) && grade <= Math.max(...levels)
      : levels.includes(grade))
  );
}

export function isGrade12Subject(subject) {
  if (!subject) return false;
  const gradeLevel = String(subject.gradeLevel || "").trim().toLowerCase();
  if (gradeLevel) {
    const levels = gradeLevel.match(/\d+/g)?.map(Number) || [];
    if (levels.length > 0) {
      return levels.length > 1
        ? 12 >= Math.min(...levels) && 12 <= Math.max(...levels)
        : levels.includes(12);
    }
  }
  const code = String(subject.code || "").toUpperCase();
  if (/_(9|10|11)\b/.test(code)) return false;
  return true;
}

export function matchesStudentStream(item, studentStream, allSubjects = []) {
  if (!item) return false;
  const normalizedStream = studentStream === "social" ? "social" : "natural";

  let subjObj = null;
  if (item.subjectId !== undefined) {
    subjObj =
      typeof item.subjectId === "object" && item.subjectId !== null
        ? item.subjectId
        : (allSubjects || []).find((s) => String(s._id || s.id) === String(item.subjectId)) || null;
  } else {
    subjObj = item;
  }

  const explicitStream = String(subjObj?.stream || "").toLowerCase();
  if (explicitStream === "both") return true;
  if (explicitStream === "natural" || explicitStream === "social") {
    return explicitStream === normalizedStream;
  }

  const code = String(subjObj?.code || item.code || "").toUpperCase();
  const text = `${subjObj?.name || ""} ${item.title || ""}`.toLowerCase();

  if (normalizedStream === "natural") {
    if (["HIST", "GEOG", "ECON", "MATH_SOC"].some((k) => code.includes(k))) return false;
    if (
      text.includes("history") ||
      text.includes("geography") ||
      text.includes("economics") ||
      text.includes("social studies")
    ) {
      return false;
    }
    return true;
  }

  if (["BIO", "CHEM", "PHYS", "MATH_NAT"].some((k) => code.includes(k))) return false;
  if (text.includes("biology") || text.includes("chemistry") || text.includes("physics")) {
    return false;
  }
  return true;
}
