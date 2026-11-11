// #261: clipboard HTML as Google Docs, Notion and Word put it on the clipboard
// (trimmed to the parts that matter, shapes kept as the apps write them).

export const GOOGLE_DOCS =
	'<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1a2b3c4d-7fff-1234-abcd-0123456789ab">' +
	'<h1 dir="ltr" style="line-height:1.38;margin-top:20pt;margin-bottom:6pt;"><span style="font-size:20pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">Launch plan</span></h1>' +
	'<p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;">' +
	'<span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;font-weight:400;">We ship </span>' +
	'<span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;font-weight:700;">Monday</span>' +
	'<span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;font-weight:400;"> and </span>' +
	'<span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;font-weight:400;font-style:italic;">celebrate</span>' +
	'<span style="font-size:11pt;font-family:Arial,sans-serif;font-weight:400;"> </span>' +
	'<span style="font-size:11pt;font-family:Arial,sans-serif;font-weight:400;text-decoration:underline;-webkit-text-decoration-skip:none;text-decoration-skip-ink:none;">after</span>' +
	'<span style="font-size:11pt;font-family:Arial,sans-serif;font-weight:400;">, </span>' +
	'<span style="font-size:11pt;font-family:Arial,sans-serif;font-weight:400;text-decoration:line-through;">not before</span>' +
	'<span style="font-size:11pt;font-family:Arial,sans-serif;font-weight:400;">.</span></p>' +
	'<ul style="margin-top:0;margin-bottom:0;padding-inline-start:48px;">' +
	'<li dir="ltr" style="list-style-type:disc;font-size:11pt;font-family:Arial,sans-serif;color:#000000;" aria-level="1"><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;" role="presentation"><span style="font-size:11pt;font-family:Arial,sans-serif;font-weight:400;">First</span></p></li>' +
	'<li dir="ltr" style="list-style-type:disc;font-size:11pt;font-family:Arial,sans-serif;color:#000000;" aria-level="1"><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;" role="presentation"><span style="font-size:11pt;font-family:Arial,sans-serif;font-weight:400;">Second </span><a href="https://example.com/x" style="text-decoration:none;"><span style="font-size:11pt;font-family:Arial,sans-serif;color:#1155cc;font-weight:400;text-decoration:underline;-webkit-text-decoration-skip:none;text-decoration-skip-ink:none;">link</span></a></p></li>' +
	'</ul><p dir="ltr"><br></p></b>';

export const NOTION =
	'<meta charset="utf-8"><h2 class="notion-h2" id="a1b2" style="font-family:ui-sans-serif, -apple-system;">Notes</h2>' +
	'<p class="notion-text">Plain and <strong class="notion-bold">bold</strong> and <code style="font-family:&quot;SFMono-Regular&quot;, Menlo;color:#EB5757;background:rgba(135,131,120,0.15)">code</code>.</p>' +
	'<blockquote class="notion-quote" style="border-left:3px solid currentcolor">Quoted</blockquote>' +
	'<ol class="notion-numbered-list" type="1" start="1"><li style="font-family:ui-sans-serif">One</li><li><span style="color:rgba(55,53,47,1)">Two</span></li></ol>';

export const WORD = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta http-equiv=Content-Type content="text/html; charset=utf-8"><meta name=Generator content="Microsoft Word 15">
<style><!--
 /* Font Definitions */
 @font-face {font-family:Calibri;}
 p.MsoNormal {mso-style-unhide:no; margin:0in; font-size:11.0pt; font-family:"Calibri",sans-serif;}
--></style><!--[if gte mso 9]><xml><o:shapedefaults v:ext="edit" spidmax="1026" /></xml><![endif]--></head>
<body lang=EN-US style='tab-interval:.5in;word-wrap:break-word'>
<!--StartFragment--><div class=WordSection1>
<p class=MsoNormal>Dear <b><span style='font-family:"Calibri",sans-serif'>team</span></b>,<i><span style='mso-bidi-font-family:Calibri'> thanks</span></i><o:p></o:p></p>
<p class=MsoListParagraphCxSpFirst style='text-indent:-.25in;mso-list:l0 level1 lfo1'><![if !supportLists]><span style='font-family:Symbol;mso-fareast-font-family:Symbol'><span style='mso-list:Ignore'>·<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; </span></span></span><![endif]>Apples<o:p></o:p></p>
<p class=MsoListParagraphCxSpLast style='text-indent:-.25in;mso-list:l0 level1 lfo1'><![if !supportLists]><span style='font-family:Symbol'><span style='mso-list:Ignore'>·<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;&nbsp; </span></span></span><![endif]>Pears<o:p></o:p></p>
<p class=MsoListParagraph style='text-indent:-.25in;mso-list:l1 level1 lfo2'><![if !supportLists]><span style='mso-fareast-font-family:Calibri'><span style='mso-list:Ignore'>1.<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;&nbsp;&nbsp; </span></span></span><![endif]>Step one<o:p></o:p></p>
</div><!--EndFragment-->
</body>
</html>`;
