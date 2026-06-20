// Privacy-scrubbed regression fixtures derived from user-supplied email formats.
// These preserve parser-relevant wording only. Personal contact information,
// payment accounts, building access codes, and policy boilerplate are omitted.
export const realEmailFormats = [
  {
    platform: "Mindbody",
    subject:
      "Payment methods to complete your booking for Beg House - Huu Rock on 6/3/2026 at 6:30 PM",
    from: "PJM DANCE NYC <Business@example.mindbodyonline.com>",
    body:
      "Thank you for booking a class at PJM! Complete your booking for Beg House - Huu Rock with Huu Rock on Wednesday, 6/3/2026, at 6:30 PM.",
    expected: {
      eventType: "booked",
      className: "Beg House - Huu Rock",
      studio: "PJM DANCE NYC",
      teacher: "Huu Rock",
      classDate: "2026-06-03",
      classTime: "18:30",
    },
  },
  {
    platform: "Mindbody",
    subject: "Peridance Center Reservation for Beg House on 6/6/2026 at 12:00 PM!",
    from: "Peridance Center <Business@example.mindbodyonline.com>",
    body:
      "This confirms your reservation for Beg House with Huu Rock on Saturday, 6/6/2026 at 12:00 PM.",
    expected: {
      eventType: "booked",
      className: "Beg House",
      studio: "Peridance Center",
      teacher: "Huu Rock",
      classDate: "2026-06-06",
      classTime: "12:00",
    },
  },
  {
    platform: "Mindbody",
    subject:
      "reservation for 6/6/2026 at 12:00 PM at Peridance Center Has Been Cancelled",
    from: "Peridance Center <Business@example.mindbodyonline.com>",
    body:
      "This confirms that Beg House reservation on 6/6/2026 at 12:00 PM has been cancelled.",
    expected: {
      eventType: "canceled",
      className: "Beg House",
      studio: "Peridance Center",
      classDate: "2026-06-06",
      classTime: "12:00",
    },
  },
  {
    platform: "Arketa",
    subject: "Reservation Confirmation - Class with Edson Maldonado",
    from: "Modega <no-reply@notifications.arketa.co>",
    body:
      "You have successfully booked The E'fect: Beginner/Adv-Beginner Choreography Intensive.\nThe E'fect: Beginner/Adv-Beginner Choreography Intensive\nEdson Maldonado\nSun, Mar 29, 2026, 03:30 PM - 06:30 PM EDT",
    expected: {
      eventType: "booked",
      className: "The E'fect: Beginner/Adv-Beginner Choreography Intensive",
      studio: "Modega",
      teacher: "Edson Maldonado",
      classDate: "2026-03-29",
      classTime: "15:30",
    },
  },
  {
    platform: "Direct",
    subject:
      "Re: 【课程确认】中阶女团 - Up - Nov, 22nd, Sat - 4 PM - @Gibney 280 Broadway",
    from: "Afterschool Dance <classes@example.com>",
    body:
      "感谢报名我们的中阶女团！\n时间： 11月22日（周六）4 – 5:30PM\n曲目： Karina(aespa) - Up\n教师： Tiffany\n地点： Gibney 280 Broadway (studio G)",
    expected: {
      eventType: "booked",
      className: "Intermediate K-Pop Girl Group",
      studio: "Gibney 280 Broadway (studio G)",
      teacher: "Tiffany",
      danceStyle: "K-Pop",
      classDate: "2025-11-22",
      classTime: "16:00",
    },
  },
  {
    platform: "Mindbody",
    subject:
      "I Love Dance Reminder: In-StudioM: Big Girls Don't Cry | ENHYPEN (Part 1) at 6:30pm on 3/7/2026",
    from: "I Love Dance <Business@example.mindbodyonline.com>",
    body:
      "This is a reminder for your reservation for In-StudioM: Big Girls Don't Cry | ENHYPEN (Part 1) with Maylin Ramos on Saturday, 3/7/2026. Class will start at 6:30pm.",
    expected: {
      eventType: "booked",
      className: "In-StudioM: Big Girls Don't Cry | ENHYPEN (Part 1)",
      danceStyle: "K-Pop",
      styleSource: "song_only_fallback",
      styleConfidence: 0.7,
      studio: "I Love Dance",
      teacher: "Maylin Ramos",
      classDate: "2026-03-07",
      classTime: "18:30",
    },
  },
] as const;
