import { gradebookJsonToXML, parseGradebookXML } from '$lib/synergy';
import type { AssignmentEntity } from '$lib/types/Gradebook';
import { expect, test } from 'bun:test';

const assignment = {
	gradebookID: '123456',
	measure: 'Ch. 3 Quiz',
	type: 'Quiz',
	date: '1/1/2024',
	displayScore: '3 out of 4',
	score: '3',
	scoreMaxValue: '4',
	points: '3 / 4',
	notes: '',
	hasDropBox: false,
	resources: []
};

const gradebook = {
	type: 'Traditional',
	errorMessage: null,
	reportingPeriods: [{ index: '2', gradePeriod: 'S1', startDate: '8/1/2024', endDate: '1/1/2025' }],
	reportingPeriod: { index: '2', gradePeriod: 'S1', startDate: '8/1/2024', endDate: '1/1/2025' },
	courses: [
		{
			period: '1',
			title: 'Algebra (1234)',
			staffEMail: 'teacher@example.com',
			marks: [
				{
					markName: 'S1',
					calculatedScoreString: 'A',
					gradeCalculationSummary: {
						assignmentGradeCalc: [
							{ type: 'Quiz', weight: '60%', points: '3', pointsPossible: '4' }
						]
					},
					assignments: [assignment, { ...assignment, gradebookID: '123457', score: null }],
					assignmentsSinceLastAccess: [],
					standardViews: []
				}
			]
		}
	]
};

test('JSON gradebook round-trips through the legacy XML parser', () => {
	const parsed = parseGradebookXML(gradebookJsonToXML(gradebook));

	expect(parsed.ReportingPeriod._Index).toBe('2');
	expect(parsed.ReportingPeriods.ReportPeriod[0]!._GradePeriod).toBe('S1');
	expect(Array.isArray(parsed.Courses.Course)).toBe(true);

	const course = parsed.Courses.Course[0]!;
	expect(course._Title).toBe('Algebra (1234)');
	expect(course._StaffEMail).toBe('teacher@example.com');

	const mark = course.Marks!.Mark[0]!;
	expect(mark._CalculatedScoreString).toBe('A');
	expect(mark.GradeCalculationSummary!.AssignmentGradeCalc[0]!._PointsPossible).toBe('4');
	expect(mark.AssignmentsSinceLastAccess).toBeNull();

	const [graded, ungraded] = mark.Assignments!.Assignment as [AssignmentEntity, AssignmentEntity];
	expect(graded._Measure).toBe('Ch. 3 Quiz');
	expect(graded._Points).toBe('3 / 4');
	expect(graded._HasDropBox).toBe(false);
	expect(graded._Score).toBe('3');
	expect(ungraded).not.toHaveProperty('_Score');
});
