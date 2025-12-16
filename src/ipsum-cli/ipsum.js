/*

TODO: 

- add markdown tokenizer
- output to file
- output to json

*/

function getRandomElement(arr) {
  const randomIndex = Math.floor(Math.random() * arr.length);
  return arr[randomIndex];
}

// source material https://en.wikipedia.org/wiki/Lorem_ipsum
const loremIpsum = `Sed ut perspiciatis, unde omnis iste natus error sit voluptatem accusantium doloremque laudantium, totam rem aperiam eaque ipsa, quae ab illo inventore veritatis et quasi architecto beatae vitae dicta sunt, explicabo. Nemo enim ipsam voluptatem, quia voluptas sit, aspernatur aut odit aut fugit, sed quia consequuntur magni dolores eos, qui ratione voluptatem sequi nesciunt, neque porro quisquam est, qui dolorem ipsum, quia dolor sit amet consectetur adipisci velit, sed quia non numquam do eius modi tempora incididunt, ut labore et dolore magnam aliquam quaerat voluptatem. Ut enim ad minima veniam, quis nostrum exercitationem ullam corporis suscipit laboriosam, nisi ut aliquid ex ea commodi consequatur? Quis autem vel eum i ure reprehenderit, qui in ea voluptate velit esse, quam nihil molestiae consequatur, vel illum, qui dolorem eum fugiat, quo voluptas nulla pariatur? At vero eos et accusamus et iusto odio dignissimos ducimus, qui blanditiis praesentium voluptatum deleniti atque corrupti, quos dolores et quas molestias excepturi sint, obcaecati cupiditate non provident, similique sunt in culpa, qui officia deserunt mollitia animi, id est laborum et dolorum fuga. Et harum quidem rerudum facilis est ert expedita distinctio. Nam libero tempore, cum soluta nobis est eligendi optio, cumque nihil impedit, quo minus id, quod maxime placeat facere possimus, omnis voluptas assumenda est, omnis dolor repellend a us. Temporibus autem quibusdam et aut officiis debitis aut rerum necessitatibus saepe eveniet, ut et voluptates repudiandae sint et molestiae non recusandae. Itaque earum rerum hic tenetur a sapiente delectus, ut aut reiciendis voluptatibus maiores alias consequatur aut perferendis doloribus asperiores repellat.`

const splitLorem = loremIpsum.split(' ')

const ipsumLimit = splitLorem.length;  // the number of individual words in the Lorem Ipsum passage

const mdTokens = [
  "_$_",
  "**$**",
  "***$***",
  "`$`",
  "[$](#$)"
]

const mdChance = 0.8;

function markdownTokenizer(segment){
  let markdown = getRandomElement(mdTokens).replaceAll('$', segment)
  return markdown
}

export async function ipsum(
  args,
  options
) {

  const num = args[0] || options.num || 100;
  const type = args[1] || options.type || "text";
  const output = args[2] || options.output || "stout";

  let ipsumBuffer = ''  // string we will concat segments to
  let j = 0             // virtual counter

    // run loop "num" times
    for(let i = 0;i < num; i++){ 
      if(j < ipsumLimit){
        if(type == "text"){
          ipsumBuffer += ' '+splitLorem[j] // append string segment
          j++
        } else if(type == "markdown"){ // if markdown, generate random number to tokenize as markdown
          let randomNumber = Math.random(); 
          if (randomNumber < mdChance) { // adjust mdChance variable
            ipsumBuffer += ' '+splitLorem[j] // regular string
          } else {
            ipsumBuffer += ' '+markdownTokenizer(splitLorem[j]) // markdown tokenized
          }
          j++
        }
      } else {
        j = 0
      }
    }

    if(output == "stout"){

      return ipsumBuffer

    } else {

      const path = `${output}`;
      await Bun.write(path, ipsumBuffer);

    }
    


}
