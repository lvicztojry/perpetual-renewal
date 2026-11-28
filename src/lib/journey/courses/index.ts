import type { CourseDefinition, CourseStep } from "./types";
import { mainCourse } from "./main";
import {
  accountDataCourse, chatCharacterCourse, chatCourse, dreamCourse, groupMemoryCourse, groupsCourse,
  materialImportCourse, memoryCourse, modelCourse, peopleCourse, preferencesCourse, proactiveCourse, voiceCourse
} from "./independent";

export const mainCourseId = "main";

/** Directory order: main line first, then the independent lessons in learning order. */
export const allCourses: CourseDefinition[] = [
  mainCourse, peopleCourse, chatCourse, memoryCourse, materialImportCourse, chatCharacterCourse,
  dreamCourse, groupsCourse, groupMemoryCourse, voiceCourse, proactiveCourse, modelCourse,
  preferencesCourse, accountDataCourse
];

const byId = new Map(allCourses.map(course => [course.id, course]));

export function getCourse(id: string): CourseDefinition | undefined {
  return byId.get(id);
}

export function courseStep(courseId: string, stepId: string): CourseStep | undefined {
  return byId.get(courseId)?.steps.find(step => step.id === stepId);
}

export function nextStep(course: CourseDefinition, stepId: string): CourseStep | null {
  const step = course.steps.find(item => item.id === stepId);
  if (!step || !step.next) return null;
  return course.steps.find(item => item.id === step.next) ?? null;
}

export const courseIds = allCourses.map(course => course.id);

/**
 * Static graph check used by tests and by JG-01 handoff: every `next` resolves,
 * every course ends, and no ID is duplicated. Returns human-readable problems.
 */
export function validateCourses(courses: CourseDefinition[] = allCourses): string[] {
  const problems: string[] = [];
  const seenCourses = new Set<string>();
  for (const course of courses) {
    if (seenCourses.has(course.id)) problems.push(`duplicate course id ${course.id}`);
    seenCourses.add(course.id);
    const ids = new Set<string>();
    for (const step of course.steps) {
      if (ids.has(step.id)) problems.push(`${course.id}: duplicate step id ${step.id}`);
      ids.add(step.id);
    }
    for (const step of course.steps) {
      if (step.next && !ids.has(step.next)) problems.push(`${course.id}/${step.id}: dangling next ${step.next}`);
      if (step.completion.type === "evidence" && !step.target && step.kind !== "action" && step.kind !== "wait") {
        problems.push(`${course.id}/${step.id}: evidence step should point at a target`);
      }
    }
    if (!course.steps.length) problems.push(`${course.id}: empty course`);
    else if (course.steps.at(-1)?.next) problems.push(`${course.id}: last step must be terminal`);
  }
  return problems;
}

export { mainCourse };
