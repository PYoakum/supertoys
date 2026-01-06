import css from './templates/style.css' with { type: "text" };
import title from './templates/title.txt' with { type: "text" };
import baseTemplate from './templates/base.html' with { type: "text" };
import loadDocuments from './load-documents.js'
import markdownToHtml from '../../md2html/index.js'




export default async function render(_url) {

    function isChecked(index){
    if(index == "0"){
        return 'checked'
    } else {
        return
    }
}

const docs = await loadDocuments(__dirname+'/content');

let content = {
        buttons : '',
        navbar : '',
        markup : ''
}

    // Access the data
docs.forEach((doc, index) => {
   
    content.buttons += `<input type="radio" name="page" id="page${(index)}" class="page-radio" ${isChecked(index)}>`
    content.navbar += `<label for="page${index}" class="nav-label">${doc.filename}</label>`
    
    let html = markdownToHtml(doc.content, {
        sanitize: true,
        headerIds: true,
        highlightCode: true
    })
    
    content.markup += `<div class="page-container page${index}-container">
        <div class="content-box">
            ${html}
        </div>
    </div>`

});

const _head = `<style>${await css}</style><title>${await title}</title>`

function generatePages(content){
    return `<div id="app">
        ${content.buttons}
        <nav class="nav-bar">
            ${content.navbar}
        </nav>
        <div class="container-wrapper">
            ${content.markup}
        </div>
    </div>`
}

    

    let html = await baseTemplate;
    let rendered = generatePages(content)
    const regexHead = /{{HEAD}}/i;
    html.replace(regexHead, _head.toString());
    

    html.replace('{{BODY}}', rendered);
    console.log('html',html)
    console.log(rendered)
    return await html

}