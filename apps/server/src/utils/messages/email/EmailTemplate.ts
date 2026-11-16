const generalEmailSender = "no-reply@hccnj.org";

const emailType = {
	firstTimers: {
		templateId: "2308016f-3559-4f9c-93b5-60747928f196",
		subject: "Welcome to HCC Femily",
		name: "HolyGhost Christian Center NJ",
		nickname: "HCCNJ",
		from: generalEmailSender,
	},
	CovidGiveHelp: {
		// / Registration Complete
		templateId: "5d425113-037e-41e1-a509-d6c829473ae0",
		subject: "Thanks For your Giving",
		name: "HolyGhost Christian Center NJ",
		nickname: "HCCNJ",
		from: generalEmailSender,
	},
	CovidGetHelp: {
		// / Registration Complete
		templateId: "5d425113-037e-41e1-a509-d6c829473ae0",
		subject: "Thanks For your Giving",
		name: "HolyGhost Christian Center NJ",
		nickname: "HCCNJ",
		from: generalEmailSender,
	},
	WordofTheMonth: {
		templateId: "95e7d4f5-f572-44e2-bb63-b296ee1310eb",
		subject: "Word Activation",
		name: "HolyGhost Christian Center NJ",
		nickname: "HCCNJ",
		from: "no-reply@hccnj.org",
	},
	JoinDepartmetWelcome: {
		templateId: "db8fe388-3746-4e70-a088-143eb3796554",
		subject: "Thanks for Joining",
		name: "HolyGhost Christian Center NJ",
		nickname: "HCCNJ",
		from: "no-reply@hccnj.org",
	},
	SmallGroupWelcome: {
		templateId: "6b8116f6-6c9e-4530-a304-596eeda9a93d",
		subject: "Thanks for Joining",
		name: "HolyGhost Christian Center NJ",
		nickname: "HCCNJ",
		from: "no-reply@hccnj.org",
	},
	SmallGroupHost: {
		templateId: "fa02967d-d710-4469-8278-8ec0ec469e64",
		subject: "Interest In Small Group",
		name: "HolyGhost Christian Center NJ",
		nickname: "HCCNJ",
		from: "no-reply@hccnj.org",
	},
	SpeakerMessageReminder: {
		templateId: "d1be69d3-6d4b-46b8-9cba-b68537d7d569",
		subject: "Message Reminder",
		name: "Media HCCNJ",
		nickname: "HCCNJ Media",
		from: "media@hccnj.org",
	},
	EventsCheckList: {
		// / Registration Complete
		templateId: "65a774a7-8307-40e6-8b49-7469976364d6",
		subject: "Upcoming Events Checklist",
		name: "HolyGhost Christian Center NJ",
		nickname: "HCCNJ",
		from: "no-reply@hccnj.org",
	},
	EmailSignIn: {
		templateId: "f56cdb6b-c5e3-47fc-9416-41699e16443e",
		subject: "Signin Link",
		name: "HolyGhost Christian Center North America",
		nickname: "HCCNA",
		from: "no-reply@hccnj.org",
	},
	AuthSignInCode: {
		templateId: "dde60bfe-987b-4ed0-8325-fe5f8a43f73f",
		subject: "Signin Code",
		name: "HolyGhost Christian Center North America",
		nickname: "HCCNA",
		from: "no-reply@hccnj.org",
	},
	DeleteSignInCode: {
		templateId: "63560d43-5e3e-42db-85d7-129476dc3b21",
		subject: "Confirm account deletion",
		name: "HolyGhost Christian Center North America",
		nickname: "HCCNA",
		from: "no-reply@hccnj.org",
	},
	TooManySignInAttempts: {
		templateId: "f4d4e96d-c093-4c2a-bee1-26a2fdbf456b",
		subject: "Multiple Failed Code Verification Attempts",
		name: "HolyGhost Christian Center North America",
		nickname: "HCCNA",
		from: "no-reply@hccnj.org",
	},
} as const;

interface EmailType {
	type: keyof typeof emailType;
	notificationType?: string;
	dueDate?: string;
}

export type EmailTemplateID = keyof typeof emailType;

interface ResponseType {
	templateId: string;
	subject: string;
	from: string;
}

export const config = (data: EmailType): ResponseType => emailType[data.type];
