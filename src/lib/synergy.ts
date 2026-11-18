import type { AttachmentResult } from '$lib/types/Attachment';
import type { AttendanceResult } from '$lib/types/Attendance';
import type { AuthTokenResult } from '$lib/types/AuthToken';
import type { DocumentsResult } from '$lib/types/Documents';
import type { MailResult } from '$lib/types/MailData';
import type { StudentInfoResult } from '$lib/types/StudentInfo';
import { XMLBuilder, XMLParser } from 'fast-xml-parser';
import type { GradebookResult } from './types/Gradebook';
import type { ReportCardResult } from './types/ReportCard';

export const demoMockDomain = 'demo.gradecompass.com';

export const Operation = {
	Request: 'ProcessWebServiceRequest',
	RequestMultiWeb: 'ProcessWebServiceRequestMultiWeb'
} as const;

export type Operation = (typeof Operation)[keyof typeof Operation];

const MethodName = {
	Gradebook: 'Gradebook',
	Attendance: 'Attendance',
	StudentInfo: 'StudentInfo',
	Documents: 'GetStudentDocumentInitialData',
	ReportCard: 'GetReportCardDocumentData',
	Mail: 'SynergyMailGetData',
	Attachment: 'SynergyMailGetAttachment',
	GenerateAuthToken: 'GenerateAuthToken'
} as const;

type MethodName = (typeof MethodName)[keyof typeof MethodName];

const alwaysArray = [
	'Gradebook.Courses.Course',
	'Gradebook.Courses.Course.Marks.Mark',
	'Gradebook.Courses.Course.Marks.Mark.Assignments.Assignment',
	'Gradebook.Courses.Course.Marks.Mark.Assignments.Assignment.Resources.Resource',
	'Gradebook.ReportingPeriods.ReportPeriod',
	'Attendance.Absences.Absence',
	'SynergyMailDataXML.InboxItemListings.MessageXML',
	'StudentDocuments.StudentDocumentDatas.StudentDocumentData',
];

const envelopeParser = new XMLParser({ ignoreDeclaration: true });

const resultParser = new XMLParser({
	ignoreAttributes: false,
	ignoreDeclaration: true,
	attributeNamePrefix: '_',
	isArray: (_name, jpath) => alwaysArray.includes(jpath),
	attributeValueProcessor: (_name, value) =>
		value === 'true' ? true : value === 'false' ? false : value
});

/** For use only with output of xml parser; applies only to non-attributes */
function convertEmptyElementToNull<T>(obj: T): T {
	if (typeof obj !== 'object' || obj === null) return obj;

	if (Array.isArray(obj)) return obj.map(convertEmptyElementToNull) as T;

	const newObj: any = {};
	for (const [key, val] of Object.entries(obj)) {
		if (val === '' && !key.startsWith('_')) {
			newObj[key] = null;
		} else {
			newObj[key] = convertEmptyElementToNull(val);
		}
	}
	return newObj;
}

const builder = new XMLBuilder({ ignoreAttributes: false, attributeNamePrefix: '_' });

export const unwrapEnvelope = (envelopeStr: string, operation: Operation): string =>
	envelopeParser.parse(envelopeStr)['soap:Envelope']['soap:Body'][`${operation}Response`][
		`${operation}Result`
	];

export const wrapEnvelope = (body: string, operation: Operation): string =>
	builder.build({
		'?xml': { _version: '1.0', _encoding: 'utf-8' },
		'soap:Envelope': {
			'_xmlns:soap': 'http://www.w3.org/2003/05/soap-envelope',
			'_xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
			'_xmlns:xsd': 'http://www.w3.org/2001/XMLSchema',
			'soap:Body': {
				[`${operation}Response`]: {
					_xmlns: 'http://edupoint.com/webservices/',
					[`${operation}Result`]: body
				}
			}
		}
	});

export function parseResult<T>(resultStr: string): T {
	const result = resultParser.parse(resultStr);

	if (result.RT_ERROR) throw new Error(result.RT_ERROR._ERROR_MESSAGE);

	return result;
}

interface Credentials {
	domain: string;
	userID: string;
	password: string;
}

async function fetchSoap(
	operation: Operation,
	methodName: MethodName,
	{ domain, userID, password }: Credentials,
	params: Record<string, unknown> = {}
) {
	const res = await fetch(`https://${domain}/Service/PXPCommunication.asmx`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/soap+xml; charset=utf-8' },
		body: builder.build({
			'soap12:Envelope': {
				'_xmlns:soap12': 'http://www.w3.org/2003/05/soap-envelope',
				'soap12:Body': {
					[operation]: {
						_xmlns: 'http://edupoint.com/webservices/',
						userID,
						password,
						skipLoginLog: true,
						parent: false,
						webServiceHandleName: 'PXPWebServices',
						methodName,
						paramStr: builder.build({ Params: params })
					}
				}
			}
		})
	});

	if (res.status !== 200) throw new Error(`HTTP ${res.status} when requesting ${operation}`);

	return res;
}

async function soapRequest<T>(
	operation: Operation,
	methodName: MethodName,
	credentials: Credentials,
	params: Record<string, unknown> = {}
) {
	const res = await fetchSoap(operation, methodName, credentials, params);

	const envelopeStr = await res.text();

	const resultStr = unwrapEnvelope(envelopeStr, operation);

	return parseResult<T>(resultStr);
}

const webServiceRequest = <T>(
	methodName: MethodName,
	credentials: Credentials,
	params: Record<string, unknown> = {}
) => soapRequest<T>(Operation.Request, methodName, credentials, params);

const webServiceRequestMultiWeb = <T>(
	methodName: MethodName,
	credentials: Credentials,
	params: Record<string, unknown> = {}
) => soapRequest<T>(Operation.RequestMultiWeb, methodName, credentials, params);

export const parseGradebookXML = (resultStr: string) =>
	convertEmptyElementToNull(parseResult<GradebookResult>(resultStr).Gradebook);

type JsonObject = Record<string, unknown>;

/** JSON key -> legacy XML element. Without `wrapper`, the elements are direct children. */
const gradebookElements: Record<string, { tag: string; wrapper?: string; single?: true }> = {
	reportingPeriods: { wrapper: 'ReportingPeriods', tag: 'ReportPeriod' },
	reportingPeriod: { tag: 'ReportingPeriod', single: true },
	courses: { wrapper: 'Courses', tag: 'Course' },
	marks: { wrapper: 'Marks', tag: 'Mark' },
	gradeCalculationSummary: { tag: 'GradeCalculationSummary', single: true },
	assignmentGradeCalc: { tag: 'AssignmentGradeCalc' },
	assignments: { wrapper: 'Assignments', tag: 'Assignment' },
	assignmentsSinceLastAccess: { wrapper: 'AssignmentsSinceLastAccess', tag: 'Assignment' },
	resources: { wrapper: 'Resources', tag: 'Resource' }
};

/** Scalar keys whose legacy attribute name is not the PascalCased JSON key */
const gradebookAttributeNames: Record<string, string> = { url: '_url' };

const isJsonObject = (value: unknown): value is JsonObject =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

function gradebookNode(json: JsonObject): JsonObject {
	const node: JsonObject = {};

	for (const [key, value] of Object.entries(json)) {
		const element = gradebookElements[key];

		if (!element) {
			if (value !== null && value !== undefined && typeof value !== 'object') {
				node[gradebookAttributeNames[key] ?? `_${key.charAt(0).toUpperCase()}${key.slice(1)}`] =
					value;
			}
			continue;
		}

		const source =
			key === 'gradeCalculationSummary' && Array.isArray(value)
				? { assignmentGradeCalc: value }
				: value;
		const items = (Array.isArray(source) ? source : [source])
			.filter(isJsonObject)
			.map(gradebookNode);

		if (element.single) {
			node[element.tag] = items[0] ?? '';
		} else if (element.wrapper) {
			node[element.wrapper] = items.length ? { [element.tag]: items } : '';
		} else if (items.length) {
			node[element.tag] = items;
		}
	}

	return node;
}

export const gradebookJsonToXML = (json: JsonObject) =>
	builder.build({ Gradebook: gradebookNode(json) });

interface JsonResponse {
	error?: { message: string } | null;
	data?: unknown;
	access_token?: string;
}

async function readJson(res: Response, method: string): Promise<JsonResponse> {
	try {
		return await res.json();
	} catch {
		throw new Error(`HTTP ${res.status} when requesting ${method}`);
	}
}

export class StudentAccount {
	domain: string;
	userID: string;
	password: string;

	constructor(domain: string, userID: string, password: string) {
		this.domain = domain;
		this.userID = userID;
		this.password = password;
	}

	get credentials(): Credentials {
		return {
			domain: this.domain,
			userID: this.userID,
			password: this.password
		};
	}

	private accessToken?: string;

	private async login() {
		const basic = btoa(
			String.fromCharCode(...new TextEncoder().encode(`${this.userID}:${this.password}`))
		);

		const res = await fetch(`/api/synergy/${this.domain}/AttemptLogin`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Authorization: `Basic ${basic}` },
			body: JSON.stringify({
				arguments: {
					request: JSON.stringify({ userID: null, password: null, userType: 'Student' })
				}
			})
		});
		const json = await readJson(res, 'AttemptLogin');

		if (json.error) throw new Error(json.error.message);

		this.accessToken = json.access_token as string;
	}

	private async jsonRequest<T>(method: string, params: JsonObject): Promise<T> {
		const send = async () => {
			if (!this.accessToken) await this.login();

			return await fetch(`/api/synergy/${this.domain}/${method}`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${this.accessToken}`
				},
				body: JSON.stringify({ arguments: { request: JSON.stringify(params) } })
			});
		};

		let res = await send();
		if (res.status === 401) {
			this.accessToken = undefined;
			res = await send();
		}

		const json = await readJson(res, method);

		if (json.error) throw new Error(json.error.message);

		return json.data as T;
	}

	async checkLogin() {
		if (this.domain === demoMockDomain) {
			await webServiceRequest<StudentInfoResult>('StudentInfo', this.credentials);
		} else {
			await this.login();
		}
	}

	async gradebookXML(reportPeriod?: number) {
		if (this.domain === demoMockDomain) {
			// When a specific report period is requested, if it is not available Synergy returns the current report period
			const params = reportPeriod ? { ReportPeriod: reportPeriod } : undefined;

			const res = await fetchSoap(
				Operation.Request,
				MethodName.Gradebook,
				this.credentials,
				params
			);

			return unwrapEnvelope(await res.text(), Operation.Request);
		}

		const { traditionalGradebook } = await this.jsonRequest<{
			traditionalGradebook: JsonObject | null;
		}>(MethodName.Gradebook, {
			reportPeriod: reportPeriod === undefined ? '' : String(reportPeriod),
			concurrentSchOrgYearGU: '',
			childIntID: 0,
			languageCode: 'en'
		});

		if (!traditionalGradebook) throw new Error('Standards-based gradebooks are not supported');

		return gradebookJsonToXML(traditionalGradebook);
	}

	async attendance() {
		return (await webServiceRequest<AttendanceResult>(MethodName.Attendance, this.credentials))
			.Attendance;
	}

	async studentInfo() {
		return (await webServiceRequest<StudentInfoResult>(MethodName.StudentInfo, this.credentials))
			.StudentInfo;
	}

	async documents() {
		return (await webServiceRequest<DocumentsResult>(MethodName.Documents, this.credentials))
			.StudentDocuments;
	}

	async reportCard(documentGU: string) {
		return (
			await webServiceRequest<ReportCardResult>(MethodName.ReportCard, this.credentials, {
				DocumentGU: documentGU
			})
		).DocumentData;
	}

	async mailData() {
		return (await webServiceRequest<MailResult>(MethodName.Mail, this.credentials))
			.SynergyMailDataXML;
	}

	async attachment(attachmentGU: string) {
		return (
			await webServiceRequest<AttachmentResult>(MethodName.Attachment, this.credentials, {
				SmAttachmentGU: attachmentGU
			})
		).AttachmentXML;
	}

	async getAuthToken() {
		return (
			await webServiceRequestMultiWeb<AuthTokenResult>('GenerateAuthToken', this.credentials, {
				Username: this.userID,
				TokenForClassWebSite: true,
				Usertype: 0,
				IsParentStudent: 0,
				DataString: '',
				DocumentID: 1,
				AssignmentID: 1
			})
		).AuthToken;
	}
}
